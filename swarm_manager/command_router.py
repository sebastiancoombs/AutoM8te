"""
Command Router - Translates high-level commands into pymavlink MAVLink actions.

Routes commands from OpenClaw MCP tools to appropriate MAVLink calls.
"""

import logging
import time
from typing import Optional

from pymavlink import mavutil

from .drone_registry import DroneRegistry

logger = logging.getLogger(__name__)


class CommandRouter:
    """
    Routes commands to drones via pymavlink.

    Provides high-level commands (takeoff, move, land) that abstract
    MAVLink complexity and add safety checks.
    """

    def __init__(self, registry: DroneRegistry):
        self.registry = registry
        logger.info("CommandRouter initialized (pymavlink backend)")

    def _wait_for_mode(self, drone_id: str, mode_name: str, timeout: int = 10) -> bool:
        """Wait until vehicle enters specified mode (checks state from telemetry thread)."""
        state = self.registry.get_drone(drone_id)
        start = time.time()
        while time.time() - start < timeout:
            if state.flight_mode == mode_name:
                return True
            time.sleep(0.2)
        logger.warning(f"{drone_id}: Mode timeout — wanted {mode_name}, got {state.flight_mode}")
        return False

    def _set_mode(self, drone_id: str, mode_name: str) -> bool:
        """Set flight mode by name."""
        state = self.registry.get_drone(drone_id)
        master = state.master
        mode_map = master.mode_mapping()
        if mode_name not in mode_map:
            logger.error(f"Unknown mode: {mode_name}. Available: {list(mode_map.keys())}")
            return False
        master.set_mode(mode_map[mode_name])
        return self._wait_for_mode(drone_id, mode_name)

    def _wait_for_armable(self, drone_id: str, timeout: int = 30) -> bool:
        """Wait until the vehicle is armable (EKF converged, pre-arm checks pass)."""
        state = self.registry.get_drone(drone_id)
        master = state.master
        start = time.time()
        while time.time() - start < timeout:
            # Check if we can arm by trying the pre-arm check
            # ArduPilot reports armable status via HEARTBEAT system_status
            if state.gps_fix >= 3 and state.flight_mode == "GUIDED":
                # Try to check EKF status
                msg = master.recv_match(type="EKF_STATUS_REPORT", blocking=False)
                if msg:
                    # EKF flags — check if all velocity and position filters are good
                    flags = msg.flags
                    # Bit 0: attitude, 1: velocity_horiz, 2: velocity_vert, 3: pos_horiz_rel
                    if flags & 0x0F == 0x0F:  # All basic filters OK
                        logger.info(f"{drone_id}: EKF ready (flags=0x{flags:04x})")
                        return True
            time.sleep(0.5)
        logger.warning(f"{drone_id}: Armable timeout — gps_fix={state.gps_fix}, mode={state.flight_mode}")
        return True  # Try anyway

    def _arm(self, drone_id: str, timeout: int = 15) -> bool:
        """Arm the vehicle (checks state from telemetry thread)."""
        state = self.registry.get_drone(drone_id)
        master = state.master

        # Wait for EKF to be ready
        self._wait_for_armable(drone_id, timeout=30)

        # Send arm command
        master.mav.command_long_send(
            master.target_system,
            master.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            0,
            1,  # arm
            0, 0, 0, 0, 0, 0,
        )

        start = time.time()
        while time.time() - start < timeout:
            if state.is_armed:
                return True
            time.sleep(0.2)
        logger.warning(f"{drone_id}: Arm timeout — is_armed={state.is_armed}")
        return False

    def takeoff(self, drone_id: str, altitude_m: float = 5.0) -> dict:
        """
        Command drone to take off to specified altitude.

        Sets GUIDED mode, arms, then sends takeoff command.
        """
        logger.info(f"{drone_id}: Takeoff to {altitude_m}m")

        try:
            state = self.registry.get_drone(drone_id)
            master = state.master

            # Set GUIDED mode
            if not self._set_mode(drone_id, "GUIDED"):
                return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}
            logger.info(f"{drone_id}: GUIDED mode set")

            # Arm
            if not self._arm(drone_id):
                return {"status": "error", "message": "Failed to arm", "drone_id": drone_id}
            state.is_armed = True
            logger.info(f"{drone_id}: Armed")

            # Send takeoff command
            master.mav.command_long_send(
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                0,  # confirmation
                0, 0, 0, 0, 0, 0,
                altitude_m,
            )
            state.current_task = "takeoff"
            logger.info(f"{drone_id}: Takeoff command sent")

            return {
                "status": "success",
                "message": f"{drone_id} taking off to {altitude_m}m",
                "drone_id": drone_id,
                "altitude_m": altitude_m,
            }

        except Exception as e:
            logger.error(f"{drone_id}: Takeoff failed: {e}")
            return {"status": "error", "message": f"Takeoff failed: {e}", "drone_id": drone_id}

    def land(self, drone_id: str) -> dict:
        """Command drone to land at current position."""
        logger.info(f"{drone_id}: Land command")

        try:
            state = self.registry.get_drone(drone_id)
            master = state.master

            if not self._set_mode(drone_id, "LAND"):
                return {"status": "error", "message": "Failed to set LAND mode", "drone_id": drone_id}

            state.current_task = "landing"
            return {"status": "success", "message": f"{drone_id} landing", "drone_id": drone_id}

        except Exception as e:
            logger.error(f"{drone_id}: Land failed: {e}")
            return {"status": "error", "message": f"Land failed: {e}", "drone_id": drone_id}

    def goto(self, drone_id: str, lat: float, lon: float, alt_m: float) -> dict:
        """
        Command drone to fly to a GPS coordinate.

        Args:
            drone_id: Target drone ID
            lat: Target latitude in degrees
            lon: Target longitude in degrees
            alt_m: Target altitude in meters (relative to home)
        """
        logger.info(f"{drone_id}: Goto lat={lat}, lon={lon}, alt={alt_m}m")

        try:
            state = self.registry.get_drone(drone_id)
            master = state.master

            # Ensure GUIDED mode
            if state.flight_mode != "GUIDED":
                if not self._set_mode(drone_id, "GUIDED"):
                    return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            # Send goto via SET_POSITION_TARGET_GLOBAL_INT
            master.mav.set_position_target_global_int_send(
                0,  # time_boot_ms
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                0b0000111111111000,  # type_mask: use position only
                int(lat * 1e7),
                int(lon * 1e7),
                alt_m,
                0, 0, 0,  # velocity
                0, 0, 0,  # acceleration
                0, 0,  # yaw, yaw_rate
            )

            state.current_task = "flying"
            return {
                "status": "success",
                "message": f"{drone_id} flying to ({lat:.6f}, {lon:.6f}) at {alt_m}m",
                "drone_id": drone_id,
                "target": {"lat": lat, "lon": lon, "alt_m": alt_m},
            }

        except Exception as e:
            logger.error(f"{drone_id}: Goto failed: {e}")
            return {"status": "error", "message": f"Goto failed: {e}", "drone_id": drone_id}

    def set_velocity(self, drone_id: str, vx: float, vy: float, vz: float, yaw_rate: float = 0.0) -> dict:
        """
        Set drone velocity in NED frame (m/s).

        Args:
            vx: North velocity (m/s)
            vy: East velocity (m/s)
            vz: Down velocity (m/s, negative = climb)
            yaw_rate: Yaw rate (deg/s)
        """
        logger.info(f"{drone_id}: Set velocity vx={vx}, vy={vy}, vz={vz}")

        try:
            state = self.registry.get_drone(drone_id)
            master = state.master

            if state.flight_mode != "GUIDED":
                if not self._set_mode(drone_id, "GUIDED"):
                    return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            import math
            master.mav.set_position_target_local_ned_send(
                0,
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_FRAME_LOCAL_NED,
                0b0000111111000111,  # type_mask: velocity only
                0, 0, 0,  # position (ignored)
                vx, vy, vz,
                0, 0, 0,  # acceleration (ignored)
                0, math.radians(yaw_rate),
            )

            state.current_task = "flying"
            return {
                "status": "success",
                "message": f"{drone_id} velocity set",
                "drone_id": drone_id,
                "velocity": {"vx": vx, "vy": vy, "vz": vz, "yaw_rate": yaw_rate},
            }

        except Exception as e:
            logger.error(f"{drone_id}: Set velocity failed: {e}")
            return {"status": "error", "message": f"Set velocity failed: {e}", "drone_id": drone_id}

    def return_home(self, drone_id: str) -> dict:
        """Command drone to RTL (return to launch)."""
        logger.info(f"{drone_id}: Return home")

        try:
            state = self.registry.get_drone(drone_id)
            master = state.master

            if not self._set_mode(drone_id, "RTL"):
                return {"status": "error", "message": "Failed to set RTL mode", "drone_id": drone_id}

            state.current_task = "returning_home"
            return {"status": "success", "message": f"{drone_id} returning home", "drone_id": drone_id}

        except Exception as e:
            logger.error(f"{drone_id}: Return home failed: {e}")
            return {"status": "error", "message": f"Return home failed: {e}", "drone_id": drone_id}

    def broadcast(self, command: str, **kwargs) -> dict:
        """Send command to all registered drones."""
        logger.info(f"Broadcast: {command}")

        results = []
        for drone_id in self.registry.list_drones():
            try:
                if command == "takeoff":
                    result = self.takeoff(drone_id, **kwargs)
                elif command == "land":
                    result = self.land(drone_id)
                elif command == "return_home":
                    result = self.return_home(drone_id)
                else:
                    result = {"status": "error", "message": f"Unknown command: {command}", "drone_id": drone_id}
                results.append(result)
            except Exception as e:
                results.append({"status": "error", "message": str(e), "drone_id": drone_id})

        return {
            "status": "success",
            "message": f"Broadcast '{command}' to {len(results)} drones",
            "results": results,
        }
