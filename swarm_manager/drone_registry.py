"""
Drone Registry - Centralized state management for all drones in the swarm.

Uses pymavlink for ArduPilot communication. MAVSDK was abandoned due to
broken EKF health checks with ArduPilot SITL (see memory/2026-03-21.md).

Architecture:
- Each drone gets its own pymavlink connection (one TCP client per SITL instance)
- Each drone gets a dedicated telemetry thread that continuously reads MAVLink messages
- Commands write to the connection; telemetry thread reads state changes
- This mirrors how real flight controllers work: fire-and-forget commands, observe results
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from pymavlink import mavutil

logger = logging.getLogger(__name__)


@dataclass
class DroneState:
    """State container for a single drone."""

    id: str
    connection_string: str = ""
    master: Optional[object] = None  # pymavlink connection

    # Telemetry (updated by telemetry thread)
    lat: float = 0.0  # degrees * 1e7
    lon: float = 0.0
    alt_mm: int = 0  # millimeters (MSL)
    relative_alt_mm: int = 0  # millimeters above home
    vx: int = 0  # cm/s north
    vy: int = 0  # cm/s east
    vz: int = 0  # cm/s down

    # GPS
    gps_fix_type: int = 0  # 0=no, 2=2D, 3=3D, 6=RTK
    gps_satellites: int = 0

    # Attitude
    roll: float = 0.0  # radians
    pitch: float = 0.0
    yaw: float = 0.0

    # Battery
    battery_voltage: float = 0.0  # volts
    battery_remaining: int = -1  # percent, -1 = unknown

    # System
    heartbeat_mode: int = 0
    heartbeat_custom_mode: int = 0
    is_armed: bool = False
    is_connected: bool = False
    current_task: str = "idle"

    # Internal
    _telemetry_thread: Optional[threading.Thread] = field(default=None, repr=False)
    _stop_event: Optional[threading.Event] = field(default=None, repr=False)


class DroneRegistry:
    """
    Centralized registry for all drones in the swarm.

    Manages pymavlink connections, telemetry threads, and state queries.
    Supports multiple simultaneous drone connections (one per SITL instance).
    """

    def __init__(self):
        self.drones: dict[str, DroneState] = {}
        self._lock = threading.Lock()
        logger.info("DroneRegistry initialized (pymavlink backend)")

    def register(self, drone_id: str, connection_string: str, timeout_s: float = 30.0) -> DroneState:
        """
        Register a new drone and establish pymavlink connection.

        Args:
            drone_id: Unique identifier (e.g., "drone_1")
            connection_string: pymavlink connection (e.g., "tcp:127.0.0.1:5760")
            timeout_s: Max seconds to wait for heartbeat + GPS fix

        Returns:
            DroneState for the registered drone

        Raises:
            TimeoutError: If heartbeat or GPS fix not received in time
            ConnectionError: If connection fails
        """
        if drone_id in self.drones:
            logger.warning(f"{drone_id} already registered, unregistering first")
            self.unregister(drone_id)

        logger.info(f"Registering {drone_id} at {connection_string}")

        try:
            master = mavutil.mavlink_connection(connection_string)
        except Exception as e:
            raise ConnectionError(f"Failed to connect to {connection_string}: {e}")

        # Wait for heartbeat
        logger.info(f"{drone_id}: Waiting for heartbeat...")
        hb = master.wait_heartbeat(timeout=timeout_s)
        if hb is None:
            raise TimeoutError(f"{drone_id}: No heartbeat received within {timeout_s}s")
        logger.info(f"{drone_id}: Heartbeat received (type={hb.type}, autopilot={hb.autopilot})")

        # Request all data streams at 10Hz
        master.mav.request_data_stream_send(
            master.target_system,
            master.target_component,
            mavutil.mavlink.MAV_DATA_STREAM_ALL,
            10,  # 10 Hz
            1,   # start
        )

        state = DroneState(
            id=drone_id,
            connection_string=connection_string,
            master=master,
            is_connected=True,
        )

        # Start telemetry thread
        stop_event = threading.Event()
        state._stop_event = stop_event
        t = threading.Thread(target=self._telemetry_loop, args=(state, stop_event), daemon=True)
        state._telemetry_thread = t
        t.start()

        # Wait for GPS fix
        logger.info(f"{drone_id}: Waiting for GPS fix...")
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if state.gps_fix_type >= 3 and state.gps_satellites >= 6:
                logger.info(f"{drone_id}: GPS fix acquired (type={state.gps_fix_type}, sats={state.gps_satellites})")
                break
            time.sleep(0.2)
        else:
            logger.warning(f"{drone_id}: GPS fix not acquired within timeout, continuing anyway")

        with self._lock:
            self.drones[drone_id] = state

        logger.info(f"{drone_id}: Registration complete")
        return state

    def _telemetry_loop(self, state: DroneState, stop_event: threading.Event):
        """
        Background thread that continuously reads MAVLink messages and updates drone state.

        This thread owns the recv_match() calls for this connection. Commands should NOT
        call recv_match — they set state and this thread observes the results.
        """
        master = state.master
        while not stop_event.is_set():
            try:
                msg = master.recv_match(blocking=True, timeout=1.0)
                if msg is None:
                    continue

                msg_type = msg.get_type()

                if msg_type == "HEARTBEAT":
                    state.heartbeat_mode = msg.base_mode
                    state.heartbeat_custom_mode = msg.custom_mode
                    state.is_armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)

                elif msg_type == "GLOBAL_POSITION_INT":
                    state.lat = msg.lat / 1e7
                    state.lon = msg.lon / 1e7
                    state.alt_mm = msg.alt
                    state.relative_alt_mm = msg.relative_alt
                    state.vx = msg.vx
                    state.vy = msg.vy
                    state.vz = msg.vz

                elif msg_type == "GPS_RAW_INT":
                    state.gps_fix_type = msg.fix_type
                    state.gps_satellites = msg.satellites_visible

                elif msg_type == "ATTITUDE":
                    state.roll = msg.roll
                    state.pitch = msg.pitch
                    state.yaw = msg.yaw

                elif msg_type == "BATTERY_STATUS":
                    state.battery_remaining = msg.battery_remaining

                elif msg_type == "SYS_STATUS":
                    state.battery_voltage = msg.voltage_battery / 1000.0  # mV → V

            except Exception as e:
                if not stop_event.is_set():
                    logger.error(f"{state.id}: Telemetry error: {e}")
                    time.sleep(0.5)

    def unregister(self, drone_id: str):
        """Unregister a drone and clean up its connection."""
        with self._lock:
            state = self.drones.pop(drone_id, None)

        if state is None:
            return

        logger.info(f"{drone_id}: Unregistering...")
        if state._stop_event:
            state._stop_event.set()
        if state._telemetry_thread:
            state._telemetry_thread.join(timeout=3.0)
        if state.master:
            try:
                state.master.close()
            except Exception:
                pass
        logger.info(f"{drone_id}: Unregistered")

    def get_drone(self, drone_id: str) -> DroneState:
        """Get drone state by ID."""
        with self._lock:
            if drone_id not in self.drones:
                raise KeyError(f"Drone {drone_id} not registered")
            return self.drones[drone_id]

    def list_drones(self) -> list[str]:
        """Get list of all registered drone IDs."""
        with self._lock:
            return list(self.drones.keys())

    def get_telemetry(self, drone_id: str) -> dict:
        """Get current telemetry snapshot for a drone."""
        state = self.get_drone(drone_id)
        return {
            "drone_id": state.id,
            "connected": state.is_connected,
            "armed": state.is_armed,
            "position": {
                "lat": state.lat,
                "lon": state.lon,
                "alt_msl_m": state.alt_mm / 1000.0,
                "alt_rel_m": state.relative_alt_mm / 1000.0,
            },
            "velocity": {
                "north_ms": state.vx / 100.0,
                "east_ms": state.vy / 100.0,
                "down_ms": state.vz / 100.0,
            },
            "attitude": {
                "roll_deg": round(state.roll * 57.2958, 1),
                "pitch_deg": round(state.pitch * 57.2958, 1),
                "yaw_deg": round(state.yaw * 57.2958, 1),
            },
            "gps": {
                "fix_type": state.gps_fix_type,
                "satellites": state.gps_satellites,
            },
            "battery": {
                "voltage_v": round(state.battery_voltage, 2),
                "remaining_pct": state.battery_remaining,
            },
            "current_task": state.current_task,
        }

    def get_all_telemetry(self) -> list[dict]:
        """Get telemetry for all registered drones."""
        with self._lock:
            ids = list(self.drones.keys())
        return [self.get_telemetry(d) for d in ids]

    def shutdown(self):
        """Clean shutdown — stop all telemetry threads and close connections."""
        logger.info("Shutting down DroneRegistry...")
        with self._lock:
            ids = list(self.drones.keys())
        for drone_id in ids:
            self.unregister(drone_id)
        logger.info("DroneRegistry shutdown complete")
