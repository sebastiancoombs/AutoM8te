"""
Swarm Communications — Message Bus

Drones communicate via broadcast messages on a shared bus.
In simulation: in-process message queue.
In production: mesh radio / WiFi.

Message types:
- target_found: "I see an enemy at X,Y,Z"
- target_lost: "I lost my target"
- target_killed: "Target destroyed"
- position_update: "I'm at X,Y,Z" (periodic heartbeat)
- request_assist: "Need help with my target"
- reassign: "New target assignment" (from coordinator)
"""

import time
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class SwarmMessage:
    """A message on the swarm bus."""
    type: str                    # Message type
    sender: str                  # Drone ID of sender
    timestamp: float             # When sent
    data: dict = field(default_factory=dict)  # Payload


class SwarmBus:
    """
    In-process message bus for swarm communication.
    
    Each drone subscribes to message types and gets callbacks.
    Simulates broadcast radio — every drone hears every message.
    """

    def __init__(self):
        self.subscribers = {}  # type -> list of (drone_id, callback)
        self.message_log = deque(maxlen=1000)  # For debugging
        self.lock = threading.Lock()

    def subscribe(self, drone_id: str, msg_type: str, callback: Callable):
        """Subscribe drone to a message type."""
        with self.lock:
            if msg_type not in self.subscribers:
                self.subscribers[msg_type] = []
            self.subscribers[msg_type].append((drone_id, callback))

    def broadcast(self, message: SwarmMessage):
        """Broadcast message to all subscribers of this type."""
        with self.lock:
            self.message_log.append(message)
            listeners = self.subscribers.get(message.type, [])

        # Deliver to all subscribers except sender
        for drone_id, callback in listeners:
            if drone_id != message.sender:
                try:
                    callback(message)
                except Exception as e:
                    print(f"[SwarmBus] Error delivering to {drone_id}: {e}")

    def broadcast_all(self, message: SwarmMessage):
        """Broadcast to ALL subscribers including sender."""
        with self.lock:
            self.message_log.append(message)
            listeners = self.subscribers.get(message.type, [])

        for drone_id, callback in listeners:
            try:
                callback(message)
            except Exception as e:
                print(f"[SwarmBus] Error delivering to {drone_id}: {e}")

    def get_recent(self, msg_type: str = None, limit: int = 10):
        """Get recent messages for debugging."""
        with self.lock:
            msgs = list(self.message_log)
        if msg_type:
            msgs = [m for m in msgs if m.type == msg_type]
        return msgs[-limit:]


class DroneComms:
    """
    Per-drone communication interface.
    
    Each drone gets one of these. Wraps the bus for convenience.
    """

    def __init__(self, drone_id: str, bus: SwarmBus):
        self.drone_id = drone_id
        self.bus = bus
        self.inbox = deque(maxlen=100)

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

    def listen(self, msg_type: str, callback: Callable):
        """Subscribe to a message type."""
        self.bus.subscribe(self.drone_id, msg_type, callback)

    def listen_all(self, callback: Callable):
        """Subscribe to all message types."""
        for msg_type in ["target_found", "target_killed", "target_lost",
                         "position_update", "request_assist", "reassign"]:
            self.bus.subscribe(self.drone_id, msg_type, callback)
