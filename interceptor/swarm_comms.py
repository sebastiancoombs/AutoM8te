"""
Swarm Communications — Message Bus (ZMQ)

Drones communicate via broadcast messages on a shared bus.
In simulation: inproc:// ZMQ transport (single process).
In production: tcp:// ZMQ transport (mesh radio / WiFi).

Message types:
- target_found: "I see an enemy at X,Y,Z"
- target_lost: "I lost my target"
- target_killed: "Target destroyed"
- position_update: "I'm at X,Y,Z" (periodic heartbeat)
- request_assist: "Need help with my target"
- reassign: "New target assignment" (from coordinator)
"""

import json
import time
import threading
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

import zmq


@dataclass
class SwarmMessage:
    """A message on the swarm bus."""
    type: str                    # Message type
    sender: str                  # Drone ID of sender
    timestamp: float             # When sent
    data: dict = field(default_factory=dict)  # Payload

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> "SwarmMessage":
        return cls(**json.loads(raw))


class SwarmBus:
    """
    ZMQ-based message bus for swarm communication.

    Uses a PUB socket to broadcast messages. Each message is published
    with its type as the ZMQ topic prefix so SUB sockets can filter.

    Supports inproc:// (default, for single-process sim) and tcp://
    transports via the `address` constructor parameter.
    """

    def __init__(self, ctx: zmq.Context = None, address: str = "inproc://swarm-bus"):
        self.ctx = ctx or zmq.Context()
        self.address = address

        self.pub = self.ctx.socket(zmq.PUB)
        self.pub.bind(self.address)

        self.message_log: deque = deque(maxlen=1000)
        self.lock = threading.Lock()

        # Internal SUB for get_recent — taps everything published on the bus
        self._log_sub = self.ctx.socket(zmq.SUB)
        self._log_sub.connect(self.address)
        self._log_sub.setsockopt_string(zmq.SUBSCRIBE, "")
        self._log_thread = threading.Thread(target=self._log_loop, daemon=True)
        self._log_thread.start()

    # ------------------------------------------------------------------ #
    # Internal log loop
    # ------------------------------------------------------------------ #

    def _log_loop(self):
        """Background thread that records every message for get_recent()."""
        while True:
            try:
                raw = self._log_sub.recv_string(flags=0)
                # Strip topic prefix (topic + space separator)
                _, payload = raw.split(" ", 1)
                msg = SwarmMessage.from_json(payload)
                with self.lock:
                    self.message_log.append(msg)
            except zmq.ZMQError:
                break
            except Exception:
                continue

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def broadcast(self, message: SwarmMessage):
        """Broadcast message to all subscribers of this type."""
        topic = message.type
        payload = message.to_json()
        self.pub.send_string(f"{topic} {payload}")

    def broadcast_all(self, message: SwarmMessage):
        """Broadcast to ALL subscribers including sender.

        Over ZMQ PUB/SUB every subscriber already receives every matching
        message, so this behaves identically to broadcast(). The sender
        filtering (skip-self) is handled on the DroneComms receive side.
        """
        self.broadcast(message)

    def subscribe(self, drone_id: str, msg_type: str, callback: Callable):
        """Legacy compatibility — subscriptions now live in DroneComms.

        This is a no-op on the bus itself; DroneComms.listen() handles
        topic subscription directly on its own SUB socket.
        """
        pass

    def get_recent(self, msg_type: str = None, limit: int = 10):
        """Get recent messages for debugging."""
        with self.lock:
            msgs = list(self.message_log)
        if msg_type:
            msgs = [m for m in msgs if m.type == msg_type]
        return msgs[-limit:]

    def close(self):
        """Shut down sockets."""
        self._log_sub.close()
        self.pub.close()


class DroneComms:
    """
    Per-drone communication interface.

    Each drone gets one of these.  Wraps a ZMQ SUB socket connected to the
    SwarmBus PUB address.  A background thread polls for incoming messages
    and dispatches to registered callbacks.
    """

    ALL_TOPICS = [
        "target_found", "target_killed", "target_lost",
        "position_update", "request_assist", "reassign",
    ]

    def __init__(self, drone_id: str, bus: SwarmBus, ctx: zmq.Context = None):
        self.drone_id = drone_id
        self.bus = bus
        self.ctx = ctx or bus.ctx

        # SUB socket for receiving
        self.sub = self.ctx.socket(zmq.SUB)
        self.sub.connect(bus.address)

        # Callbacks keyed by topic
        self._callbacks: dict[str, list[Callable]] = {}
        self._lock = threading.Lock()

        # Received message log (replaces old inbox deque)
        self._messages: deque = deque(maxlen=100)

        # Background receiver thread
        self._running = True
        self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._recv_thread.start()

    # ------------------------------------------------------------------ #
    # Background receiver
    # ------------------------------------------------------------------ #

    def _recv_loop(self):
        """Poll SUB socket and dispatch to callbacks."""
        while self._running:
            try:
                raw = self.sub.recv_string(flags=zmq.NOBLOCK)
            except zmq.Again:
                time.sleep(0.005)  # 5 ms idle poll
                continue
            except zmq.ZMQError:
                break

            try:
                _, payload = raw.split(" ", 1)
                msg = SwarmMessage.from_json(payload)
            except Exception:
                continue

            self._messages.append(msg)

            with self._lock:
                cbs = list(self._callbacks.get(msg.type, []))

            for cb in cbs:
                try:
                    cb(msg)
                except Exception as e:
                    print(f"[DroneComms:{self.drone_id}] callback error: {e}")

    # ------------------------------------------------------------------ #
    # Public API — sending
    # ------------------------------------------------------------------ #

    def send(self, msg_type: str, data: dict = None):
        """Send a message to the swarm."""
        msg = SwarmMessage(
            type=msg_type,
            sender=self.drone_id,
            timestamp=time.time(),
            data=data or {},
        )
        self.bus.broadcast(msg)

    def send_target_found(self, target_id: str, position: list):
        """Announce target detection."""
        self.send("target_found", {
            "target_id": target_id,
            "position": position,
        })

    def send_target_killed(self, target_id: str):
        """Announce target destruction."""
        self.send("target_killed", {"target_id": target_id})

    def send_target_lost(self, target_id: str, last_position: list):
        """Announce lost target."""
        self.send("target_lost", {
            "target_id": target_id,
            "last_position": last_position,
        })

    def send_position(self, position: list, velocity: list, state: str):
        """Periodic position heartbeat."""
        self.send("position_update", {
            "position": position,
            "velocity": velocity,
            "state": state,
        })

    def send_request_assist(self, target_id: str, reason: str = ""):
        """Request help from nearby drones."""
        self.send("request_assist", {
            "target_id": target_id,
            "reason": reason,
        })

    # ------------------------------------------------------------------ #
    # Public API — receiving
    # ------------------------------------------------------------------ #

    def listen(self, msg_type: str, callback: Callable):
        """Subscribe to a message type with a callback."""
        with self._lock:
            if msg_type not in self._callbacks:
                self._callbacks[msg_type] = []
                # First listener for this topic — add ZMQ subscription
                self.sub.setsockopt_string(zmq.SUBSCRIBE, msg_type)
            self._callbacks[msg_type].append(callback)

    def listen_all(self, callback: Callable):
        """Subscribe to all message types."""
        for msg_type in self.ALL_TOPICS:
            self.listen(msg_type, callback)

    def get_messages(self, limit: int = None) -> list[SwarmMessage]:
        """Return received messages (most recent last).

        If *limit* is given only the last *limit* messages are returned.
        """
        msgs = list(self._messages)
        if limit is not None:
            msgs = msgs[-limit:]
        return msgs

    # ------------------------------------------------------------------ #
    # Cleanup
    # ------------------------------------------------------------------ #

    def close(self):
        """Stop receiver thread and close socket."""
        self._running = False
        self._recv_thread.join(timeout=1)
        self.sub.close()
