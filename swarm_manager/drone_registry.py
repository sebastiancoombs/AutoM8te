"""
Drone Registry - Centralized state management for all drones in the swarm.

Uses pymavlink for MAVLink communication with ArduPilot SITL/real hardware.
Architecture decision (2026-03-21): Switched from MAVSDK to pymavlink because
MAVSDK's health monitoring (is_global_position_ok) never converges with
ArduPilot SITL's EKF. pymavlink is ArduPilot's native library and just works.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, List
import asyncio
import logging
import time
import threading

from pymavlink import mavutil

logger = logging.getLogger(__name__)


@dataclass
class DroneState:
    """State container for a single drone."""

    id: str  # drone_1, drone_2, etc.
    connection_string: str = ""  # e.g., "tcp:127.0.0.1:5760"
    master: object = None  # pymavlink MAVLink connection

    # Telemetry
    lat: float = 0.0  # degrees
    lon: float = 0.0  # degrees
    alt_rel: float = 0.0  # meters above home
    alt_abs: float = 0.0  # meters above sea level
    heading: float = 0.0  # degrees (0-360)
    groundspeed: float = 0.0  # m/s
    airspeed: float = 0.0  # m/s

    # Attitude
    roll: float = 0.0  # degrees
    pitch: float = 0.0  # degrees
    yaw: float = 0.0  # degrees

    # Battery
    battery_voltage: float = 0.0  # volts
    battery_percent: float = 100.0  # 0-100

    # GPS
    gps_fix: int = 0  # 0=no fix, 3=3D, 6=RTK
    gps_sats: int = 0

    # State
    flight_mode: str = "UNKNOWN"
    is_armed: bool = False
    is_connected: bool = False
    current_task: str = "idle"  # idle, takeoff, flying, tracking, landing
    tracking_object_id: Optional[str] = None

    # Safety
    collision_risk: bool = False
    last_heartbeat: float = 0.0  # timestamp of last heartbeat


class DroneRegistry:
    """
    Centralized registry for all drones in the swarm.

    Manages pymavlink connections, telemetry updates, and state queries.
    Each drone gets a background thread for telemetry polling.
    """

    def __init__(self):
        self.drones: Dict[str, DroneState] = {}
        self._telemetry_threads: Dict[str, threading.Thread] = {}
        self._running: Dict[str, bool] = {}
        logger.info("DroneRegistry initialized (pymavlink backend)")

    def register(self, drone_id: str, connection_string: str, wait_gps: bool = True, gps_timeout: int = 120) -> DroneState:
        """
        Register a new drone and establish pymavlink connection.

        Args:
            drone_id: Unique identifier (e.g., "drone_1")
            connection_string: pymavlink connection string (e.g., "tcp:127.0.0.1:5760")
            wait_gps: Whether to wait for GPS fix before returning
            gps_timeout: Max seconds to wait for GPS fix
        """
        logger.info(f"Registering {drone_id} at {connection_string}")

        # Connect via pymavlink
        master = mavutil.mavlink_connection(connection_string)

        logger.info(f"Waiting for heartbeat from {drone_id}...")
        master.wait_heartbeat(timeout=30)
        logger.info(f"  ✅ Heartbeat received from system={master.target_system}")

        # Request data streams at 10Hz
        master.mav.request_data_stream_send(
            master.target_system,
            master.target_component,
            mavutil.mavlink.MAV_DATA_STREAM_ALL,
            10,  # 10 Hz
            1,  # start
        )

        state = DroneState(
            id=drone_id,
            connection_string=connection_string,
            master=master,
            is_connected=True,
            last_heartbeat=time.time(),
        )
        self.drones[drone_id] = state

        # Wait for GPS if requested
        if wait_gps:
            logger.info(f"Waiting for GPS fix on {drone_id} (timeout={gps_timeout}s)...")
            start = time.time()
            while time.time() - start < gps_timeout:
                msg = master.recv_match(type="GPS_RAW_INT", blocking=True, timeout=2)
                if msg and msg.fix_type >= 3:
                    state.gps_fix = msg.fix_type
                    state.gps_sats = msg.satellites_visible
                    state.lat = msg.lat / 1e7
                    state.lon = msg.lon / 1e7
                    logger.info(f"  ✅ GPS fix={msg.fix_type} sats={msg.satellites_visible}")
                    break
            else:
                logger.warning(f"  ⚠️ GPS timeout for {drone_id} — continuing without fix")

        # Start telemetry monitoring thread
        self._running[drone_id] = True
        t = threading.Thread(target=self._telemetry_loop, args=(drone_id,), daemon=True)
        t.start()
        self._telemetry_threads[drone_id] = t

        logger.info(f"{drone_id} registered and telemetry monitoring started")
        return state

    def _telemetry_loop(self, drone_id: str):
        """Background thread to continuously poll drone telemetry."""
        state = self.drones[drone_id]
        master = state.master

        while self._running.get(drone_id, False):
            try:
                msg = master.recv_match(blocking=True, timeout=1)
                if msg is None:
                    continue

                mtype = msg.get_type()

                if mtype == "HEARTBEAT":
                    state.last_heartbeat = time.time()
                    state.is_armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                    state.flight_mode = mavutil.mode_string_v10(msg)

                elif mtype == "GLOBAL_POSITION_INT":
                    state.lat = msg.lat / 1e7
                    state.lon = msg.lon / 1e7
                    state.alt_rel = msg.relative_alt / 1000.0
                    state.alt_abs = msg.alt / 1000.0
                    state.heading = msg.hdg / 100.0

                elif mtype == "GPS_RAW_INT":
                    state.gps_fix = msg.fix_type
                    state.gps_sats = msg.satellites_visible

                elif mtype == "ATTITUDE":
                    import math
                    state.roll = math.degrees(msg.roll)
                    state.pitch = math.degrees(msg.pitch)
                    state.yaw = math.degrees(msg.yaw)

                elif mtype == "VFR_HUD":
                    state.groundspeed = msg.groundspeed
                    state.airspeed = msg.airspeed

                elif mtype == "BATTERY_STATUS":
                    state.battery_voltage = msg.voltages[0] / 1000.0 if msg.voltages[0] != 65535 else 0
                    if msg.battery_remaining >= 0:
                        state.battery_percent = msg.battery_remaining

                elif mtype == "SYS_STATUS":
                    if msg.voltage_battery > 0:
                        state.battery_voltage = msg.voltage_battery / 1000.0

            except Exception as e:
                logger.error(f"Telemetry error for {drone_id}: {e}")
                time.sleep(0.1)

    def get_drone(self, drone_id: str) -> DroneState:
        """Get drone state by ID."""
        if drone_id not in self.drones:
            raise KeyError(f"Drone {drone_id} not registered")
        return self.drones[drone_id]

    def list_drones(self) -> List[str]:
        """Get list of all registered drone IDs."""
        return list(self.drones.keys())

    def get_telemetry(self, drone_id: str) -> dict:
        """Get current telemetry snapshot for a drone."""
        state = self.get_drone(drone_id)
        return {
            "drone_id": state.id,
            "connected": state.is_connected,
            "armed": state.is_armed,
            "flight_mode": state.flight_mode,
            "position": {
                "lat": state.lat,
                "lon": state.lon,
                "alt_rel_m": state.alt_rel,
                "alt_abs_m": state.alt_abs,
                "heading": state.heading,
            },
            "attitude": {
                "roll": state.roll,
                "pitch": state.pitch,
                "yaw": state.yaw,
            },
            "speed": {
                "groundspeed_ms": state.groundspeed,
                "airspeed_ms": state.airspeed,
            },
            "battery": {
                "voltage": state.battery_voltage,
                "percent": state.battery_percent,
            },
            "gps": {
                "fix_type": state.gps_fix,
                "satellites": state.gps_sats,
            },
            "current_task": state.current_task,
            "tracking_object": state.tracking_object_id,
            "collision_risk": state.collision_risk,
        }

    def shutdown(self):
        """Clean shutdown - stop all telemetry threads."""
        logger.info("Shutting down DroneRegistry...")
        for drone_id in list(self._running.keys()):
            self._running[drone_id] = False
        for t in self._telemetry_threads.values():
            t.join(timeout=5)
        for state in self.drones.values():
            if state.master:
                state.master.close()
        logger.info("DroneRegistry shutdown complete")
