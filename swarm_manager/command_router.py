"""
Command Router - Translates high-level commands into pymavlink actions.

Routes commands from OpenClaw MCP tools to appropriate MAVLink calls.
All commands are synchronous (pymavlink is synchronous).

Key design: the telemetry thread in DroneRegistry owns recv_match().
Commands here send MAVLink messages and check drone state via the registry,
never calling recv_match() directly.
"""

import logging
import math
import time
from typing import Optional

from pymavlink import mavutil

from .drone_registry import DroneRegistry, DroneState
from .formations import (
    get_formation, assign_drones_to_slots, GPSPosition, _ned_to_gps,
    orbit_waypoints, multi_drone_orbit_offsets,
    search_grid_waypoints, SearchBounds,
)

logger = logging.getLogger(__name__)


class CommandRouter:
    """
    Routes high-level commands to drones via pymavlink.

    Provides: takeoff, land, goto, set_velocity, return_home, broadcast.
    """

    def __init__(self, registry: DroneRegistry):
        self.registry = registry
        logger.info("CommandRouter initialized (pymavlink backend)")

    # ── Helpers ──────────────────────────────────────────────

    def _get_state(self, drone_id: str) -> DroneState:
        return self.registry.get_drone(drone_id)

    def _set_mode(self, state: DroneState, mode_name: str, timeout_s: float = 5.0) -> bool:
        """
        Set flight mode by name (e.g., 'GUIDED', 'LAND', 'RTL').

        Returns True if mode was set successfully.
        """
        master = state.master
        mode_map = master.mode_mapping()
        if mode_name not in mode_map:
            logger.error(f"{state.id}: Unknown mode '{mode_name}'. Available: {list(mode_map.keys())}")
            return False

        mode_id = mode_map[mode_name]
        master.set_mode(mode_id)

        # Wait for mode change (observe via telemetry thread)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if state.heartbeat_custom_mode == mode_id:
                logger.info(f"{state.id}: Mode set to {mode_name}")
                return True
            time.sleep(0.1)

        logger.warning(f"{state.id}: Mode change to {mode_name} timed out")
        return False

    def _arm(self, state: DroneState, timeout_s: float = 10.0) -> bool:
        """
        Arm the drone using MAV_CMD_COMPONENT_ARM_DISARM.

        Uses the command long approach (not arducopter_arm) because
        the telemetry thread consumes all messages including ACKs.
        """
        master = state.master
        master.mav.command_long_send(
            master.target_system,
            master.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            0,  # confirmation
            1,  # arm
            0, 0, 0, 0, 0, 0,
        )

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if state.is_armed:
                logger.info(f"{state.id}: Armed")
                return True
            time.sleep(0.1)

        logger.warning(f"{state.id}: Arm timed out")
        return False

    def _disarm(self, state: DroneState, force: bool = False, timeout_s: float = 5.0) -> bool:
        """Disarm the drone."""
        master = state.master
        master.mav.command_long_send(
            master.target_system,
            master.target_component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            0,
            0,  # disarm
            21196 if force else 0,  # magic number for force disarm
            0, 0, 0, 0, 0,
        )

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if not state.is_armed:
                logger.info(f"{state.id}: Disarmed")
                return True
            time.sleep(0.1)

        logger.warning(f"{state.id}: Disarm timed out")
        return False

    def _wait_for_altitude(self, state: DroneState, target_m: float, tolerance_m: float = 1.0, timeout_s: float = 30.0) -> bool:
        """Wait for drone to reach target altitude (relative)."""
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            current_alt = state.relative_alt_mm / 1000.0
            if abs(current_alt - target_m) <= tolerance_m:
                return True
            time.sleep(0.2)
        return False

    # ── Commands ─────────────────────────────────────────────

    def takeoff(self, drone_id: str, altitude_m: float = 5.0) -> dict:
        """
        Command drone to take off to specified altitude.

        Sequence: GUIDED mode → arm → takeoff command → wait for altitude.
        """
        logger.info(f"{drone_id}: Takeoff to {altitude_m}m")

        try:
            state = self._get_state(drone_id)
            master = state.master

            # Set GUIDED mode
            if not self._set_mode(state, "GUIDED"):
                return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            # Arm
            if not state.is_armed:
                if not self._arm(state):
                    return {"status": "error", "message": "Failed to arm", "drone_id": drone_id}

            # Send takeoff command
            master.mav.command_long_send(
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                0,
                0, 0, 0, 0, 0, 0,
                altitude_m,
            )
            state.current_task = "takeoff"

            # Wait for altitude
            if self._wait_for_altitude(state, altitude_m, tolerance_m=1.5, timeout_s=30.0):
                state.current_task = "hovering"
                logger.info(f"{drone_id}: Takeoff complete, hovering at ~{altitude_m}m")
            else:
                logger.warning(f"{drone_id}: Takeoff altitude not reached within timeout")

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
        logger.info(f"{drone_id}: Land")

        try:
            state = self._get_state(drone_id)

            if not self._set_mode(state, "LAND"):
                return {"status": "error", "message": "Failed to set LAND mode", "drone_id": drone_id}

            state.current_task = "landing"

            # Wait for disarm (indicates landed)
            deadline = time.time() + 60.0
            while time.time() < deadline:
                if not state.is_armed:
                    state.current_task = "idle"
                    logger.info(f"{drone_id}: Landed and disarmed")
                    break
                time.sleep(0.5)

            return {"status": "success", "message": f"{drone_id} landing", "drone_id": drone_id}

        except Exception as e:
            logger.error(f"{drone_id}: Land failed: {e}")
            return {"status": "error", "message": f"Land failed: {e}", "drone_id": drone_id}

    def goto(self, drone_id: str, lat: float, lon: float, alt_m: float, heading_deg: float = 0.0) -> dict:
        """
        Command drone to fly to GPS coordinates.

        Args:
            lat, lon: GPS coordinates in degrees
            alt_m: Altitude MSL in meters
            heading_deg: Target heading (0=north, 90=east)
        """
        logger.info(f"{drone_id}: Goto ({lat}, {lon}, {alt_m}m)")

        try:
            state = self._get_state(drone_id)
            master = state.master

            # Ensure GUIDED mode
            if not self._set_mode(state, "GUIDED"):
                return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            # Send position target
            master.mav.mission_item_int_send(
                master.target_system,
                master.target_component,
                0,  # seq
                mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                2,  # current = 2 means "guided mode target"
                0,  # autocontinue
                0, 0, 0, 0,  # params 1-4
                int(lat * 1e7),
                int(lon * 1e7),
                alt_m,
            )
            state.current_task = "flying"

            return {
                "status": "success",
                "message": f"{drone_id} moving to ({lat}, {lon}, {alt_m}m)",
                "drone_id": drone_id,
                "target": {"lat": lat, "lon": lon, "alt_m": alt_m},
            }

        except Exception as e:
            logger.error(f"{drone_id}: Goto failed: {e}")
            return {"status": "error", "message": f"Goto failed: {e}", "drone_id": drone_id}

    def set_velocity(self, drone_id: str, vx_ms: float, vy_ms: float, vz_ms: float, yaw_rate_degs: float = 0.0) -> dict:
        """
        Set drone velocity vector (NED frame) using SET_POSITION_TARGET_LOCAL_NED.

        Args:
            vx_ms: North velocity m/s
            vy_ms: East velocity m/s
            vz_ms: Down velocity m/s (negative = climb)
            yaw_rate_degs: Yaw rate deg/s
        """
        logger.info(f"{drone_id}: Velocity ({vx_ms}, {vy_ms}, {vz_ms})")

        try:
            state = self._get_state(drone_id)
            master = state.master

            # Ensure GUIDED mode
            if not self._set_mode(state, "GUIDED"):
                return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            # type_mask: ignore position, use velocity + yaw rate
            type_mask = (
                0b0000_1100_0000_0111  # ignore pos_x, pos_y, pos_z, acc_x, acc_y, acc_z, yaw
            )

            master.mav.set_position_target_local_ned_send(
                0,  # time_boot_ms
                master.target_system,
                master.target_component,
                mavutil.mavlink.MAV_FRAME_LOCAL_NED,
                type_mask,
                0, 0, 0,  # position (ignored)
                vx_ms, vy_ms, vz_ms,  # velocity
                0, 0, 0,  # acceleration (ignored)
                0,  # yaw (ignored)
                math.radians(yaw_rate_degs),  # yaw_rate
            )
            state.current_task = "flying"

            return {
                "status": "success",
                "message": f"{drone_id} velocity set ({vx_ms}, {vy_ms}, {vz_ms})",
                "drone_id": drone_id,
            }

        except Exception as e:
            logger.error(f"{drone_id}: Velocity failed: {e}")
            return {"status": "error", "message": f"Velocity failed: {e}", "drone_id": drone_id}

    def return_home(self, drone_id: str) -> dict:
        """Command drone to return to launch and land (RTL)."""
        logger.info(f"{drone_id}: RTL")

        try:
            state = self._get_state(drone_id)

            if not self._set_mode(state, "RTL"):
                return {"status": "error", "message": "Failed to set RTL mode", "drone_id": drone_id}

            state.current_task = "returning_home"
            return {"status": "success", "message": f"{drone_id} returning home", "drone_id": drone_id}

        except Exception as e:
            logger.error(f"{drone_id}: RTL failed: {e}")
            return {"status": "error", "message": f"RTL failed: {e}", "drone_id": drone_id}

    def emergency_stop(self, drone_id: str) -> dict:
        """Emergency stop — force disarm (motors cut immediately). SITL only!"""
        logger.warning(f"{drone_id}: EMERGENCY STOP")

        try:
            state = self._get_state(drone_id)
            self._disarm(state, force=True)
            state.current_task = "emergency_stopped"
            return {"status": "success", "message": f"{drone_id} emergency stopped", "drone_id": drone_id}

        except Exception as e:
            logger.error(f"{drone_id}: Emergency stop failed: {e}")
            return {"status": "error", "message": f"Emergency stop failed: {e}", "drone_id": drone_id}

    def formation(self, formation_name: str, spacing_m: float = 10.0, alt_m: float = 10.0,
                  center_lat: Optional[float] = None, center_lon: Optional[float] = None,
                  heading_deg: float = 0.0, **kwargs) -> dict:
        """
        Command all drones into a formation (Tier 1 primitive).

        Args:
            formation_name: line, v, circle, grid, stack
            spacing_m: Distance between drones
            alt_m: Formation altitude
            center_lat/lon: Center point (default: centroid of current positions)
            heading_deg: Formation heading (for line/v)
        """
        drone_ids = self.registry.list_drones()
        if len(drone_ids) < 2:
            return {"status": "error", "message": "Formation requires 2+ drones"}

        logger.info(f"Formation: {formation_name} with {len(drone_ids)} drones")

        # Get current positions
        current_positions = []
        for did in drone_ids:
            state = self._get_state(did)
            current_positions.append(GPSPosition(
                lat=state.lat, lon=state.lon,
                alt_m=state.relative_alt_mm / 1000.0,
            ))

        # Default center: centroid of current positions
        if center_lat is None or center_lon is None:
            center_lat = sum(p.lat for p in current_positions) / len(current_positions)
            center_lon = sum(p.lon for p in current_positions) / len(current_positions)

        # Generate formation slots
        try:
            form_kwargs = {"spacing_m": spacing_m, "alt_m": alt_m}
            if formation_name.lower() in ("line", "v", "vee"):
                form_kwargs["heading_deg"] = heading_deg
            if formation_name.lower() in ("circle", "ring"):
                form_kwargs = {"radius_m": spacing_m, "alt_m": alt_m}
            slots = get_formation(formation_name, len(drone_ids), **form_kwargs)
        except ValueError as e:
            return {"status": "error", "message": str(e)}

        # Assign drones to slots (Hungarian algorithm)
        assignments = assign_drones_to_slots(current_positions, slots, center_lat, center_lon)

        # Send goto commands
        results = []
        for drone_idx, slot_idx in assignments:
            did = drone_ids[drone_idx]
            slot = slots[slot_idx]
            target = _ned_to_gps(center_lat, center_lon, slot.north_m, slot.east_m, slot.alt_m)
            result = self.goto(did, target.lat, target.lon, target.alt_m, heading_deg)
            results.append(result)

        return {
            "status": "success",
            "message": f"Formation '{formation_name}' commanded for {len(drone_ids)} drones",
            "formation": formation_name,
            "assignments": [
                {"drone": drone_ids[di], "slot": si,
                 "target": {"lat": _ned_to_gps(center_lat, center_lon, slots[si].north_m, slots[si].east_m, slots[si].alt_m).lat,
                            "lon": _ned_to_gps(center_lat, center_lon, slots[si].north_m, slots[si].east_m, slots[si].alt_m).lon,
                            "alt_m": slots[si].alt_m}}
                for di, si in assignments
            ],
            "results": results,
        }

    def orbit(self, drone_id: str, center_lat: float, center_lon: float,
              radius_m: float = 20.0, alt_m: float = 15.0, speed_ms: float = 3.0,
              clockwise: bool = True, laps: int = 0) -> dict:
        """
        Command a drone to orbit a GPS point (Tier 1 primitive).

        Sends sequential waypoints around a circle. The drone flies through
        them in order, creating a circular orbit.

        Args:
            center_lat, center_lon: Center of orbit (GPS)
            radius_m: Orbit radius in meters
            alt_m: Orbit altitude
            speed_ms: Cruise speed (not directly set — governed by GUIDED mode speed)
            clockwise: Orbit direction
            laps: Number of laps (0 = continuous until new command)
        """
        logger.info(f"{drone_id}: Orbit ({center_lat}, {center_lon}) r={radius_m}m")

        try:
            state = self._get_state(drone_id)

            # Ensure GUIDED mode
            if not self._set_mode(state, "GUIDED"):
                return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            # Get current position to find nearest entry point
            current_angle = math.atan2(
                state.lon - center_lon,
                state.lat - center_lat,
            )
            start_angle_deg = math.degrees(current_angle)

            waypoints = orbit_waypoints(
                center_lat, center_lon, radius_m, alt_m,
                num_points=36,
                start_angle_deg=start_angle_deg,
                clockwise=clockwise,
            )

            state.current_task = "orbiting"
            state._orbit_waypoints = waypoints
            state._orbit_index = 0
            state._orbit_laps = laps
            state._orbit_laps_done = 0

            # Send first waypoint to get the drone moving
            wp = waypoints[0]
            self.goto(drone_id, wp.lat, wp.lon, wp.alt_m)

            return {
                "status": "success",
                "message": f"{drone_id} orbiting ({center_lat}, {center_lon}) r={radius_m}m",
                "drone_id": drone_id,
                "orbit": {
                    "center_lat": center_lat,
                    "center_lon": center_lon,
                    "radius_m": radius_m,
                    "alt_m": alt_m,
                    "clockwise": clockwise,
                    "waypoints": len(waypoints),
                    "laps": laps if laps > 0 else "continuous",
                },
            }

        except Exception as e:
            logger.error(f"{drone_id}: Orbit failed: {e}")
            return {"status": "error", "message": f"Orbit failed: {e}", "drone_id": drone_id}

    def orbit_swarm(self, center_lat: float, center_lon: float,
                    radius_m: float = 20.0, alt_m: float = 15.0,
                    clockwise: bool = True) -> dict:
        """
        Command all drones to orbit the same point, evenly phase-offset.

        Each drone starts at a different angle so they're evenly distributed
        around the circle from the start.
        """
        drone_ids = self.registry.list_drones()
        if not drone_ids:
            return {"status": "error", "message": "No drones registered"}

        offsets = multi_drone_orbit_offsets(len(drone_ids), radius_m, alt_m, clockwise)
        results = []

        for i, drone_id in enumerate(drone_ids):
            state = self._get_state(drone_id)
            if not self._set_mode(state, "GUIDED"):
                results.append({"drone_id": drone_id, "status": "error", "message": "Mode change failed"})
                continue

            waypoints = orbit_waypoints(
                center_lat, center_lon, radius_m, alt_m,
                num_points=36,
                start_angle_deg=offsets[i],
                clockwise=clockwise,
            )

            state.current_task = "orbiting"
            state._orbit_waypoints = waypoints
            state._orbit_index = 0
            state._orbit_laps = 0
            state._orbit_laps_done = 0

            wp = waypoints[0]
            result = self.goto(drone_id, wp.lat, wp.lon, wp.alt_m)
            results.append(result)

        return {
            "status": "success",
            "message": f"{len(drone_ids)} drones orbiting ({center_lat}, {center_lon})",
            "results": results,
        }

    def advance_orbit(self, drone_id: str, tolerance_m: float = 5.0) -> Optional[dict]:
        """
        Check if drone reached current orbit waypoint and advance to next.

        Call this periodically (e.g., from a telemetry update loop) to keep
        the orbit going. Returns None if no action needed.
        """
        try:
            state = self._get_state(drone_id)
        except KeyError:
            return None

        if state.current_task != "orbiting":
            return None

        wps = getattr(state, '_orbit_waypoints', None)
        if not wps:
            return None

        idx = getattr(state, '_orbit_index', 0)
        wp = wps[idx]

        # Check if drone is close enough to current waypoint
        from .formations import _haversine_m
        dist = _haversine_m(state.lat, state.lon, wp.lat, wp.lon)

        if dist <= tolerance_m:
            # Advance to next waypoint
            next_idx = (idx + 1) % len(wps)
            if next_idx == 0:
                state._orbit_laps_done = getattr(state, '_orbit_laps_done', 0) + 1
                max_laps = getattr(state, '_orbit_laps', 0)
                if max_laps > 0 and state._orbit_laps_done >= max_laps:
                    state.current_task = "hovering"
                    logger.info(f"{drone_id}: Orbit complete ({state._orbit_laps_done} laps)")
                    return {"status": "orbit_complete", "laps": state._orbit_laps_done}

            state._orbit_index = next_idx
            next_wp = wps[next_idx]
            self.goto(drone_id, next_wp.lat, next_wp.lon, next_wp.alt_m)
            return {"status": "advancing", "waypoint": next_idx, "of": len(wps)}

        return None

    def search(self, drone_id: str, min_lat: float, min_lon: float,
               max_lat: float, max_lon: float, alt_m: float = 20.0,
               pattern: str = "grid", swath_width_m: float = 30.0) -> dict:
        """
        Command a single drone to search a rectangular area (Tier 1 primitive).

        Args:
            min_lat, min_lon, max_lat, max_lon: Bounding box
            alt_m: Search altitude
            pattern: "grid", "spiral", or "expanding"
            swath_width_m: Width per pass (based on sensor FOV)
        """
        logger.info(f"{drone_id}: Search [{min_lat},{min_lon}]-[{max_lat},{max_lon}] pattern={pattern}")

        try:
            state = self._get_state(drone_id)

            if not self._set_mode(state, "GUIDED"):
                return {"status": "error", "message": "Failed to set GUIDED mode", "drone_id": drone_id}

            bounds = SearchBounds(min_lat, min_lon, max_lat, max_lon)
            waypoints = search_grid_waypoints(
                bounds, alt_m, pattern=pattern,
                drone_count=1, drone_index=0,
                swath_width_m=swath_width_m,
            )

            state.current_task = "searching"
            state._search_waypoints = waypoints
            state._search_index = 0

            # Send first waypoint
            if waypoints:
                wp = waypoints[0]
                self.goto(drone_id, wp.lat, wp.lon, wp.alt_m)

            return {
                "status": "success",
                "message": f"{drone_id} searching area ({pattern} pattern)",
                "drone_id": drone_id,
                "search": {
                    "pattern": pattern,
                    "bounds": {"min_lat": min_lat, "min_lon": min_lon, "max_lat": max_lat, "max_lon": max_lon},
                    "alt_m": alt_m,
                    "waypoints": len(waypoints),
                },
            }

        except Exception as e:
            logger.error(f"{drone_id}: Search failed: {e}")
            return {"status": "error", "message": f"Search failed: {e}", "drone_id": drone_id}

    def search_swarm(self, min_lat: float, min_lon: float,
                     max_lat: float, max_lon: float, alt_m: float = 20.0,
                     pattern: str = "grid", swath_width_m: float = 30.0) -> dict:
        """
        Distribute a search area across all registered drones.

        Each drone gets a vertical strip of the area (grid pattern) or
        the full area (spiral/expanding with single drone fallback).
        """
        drone_ids = self.registry.list_drones()
        if not drone_ids:
            return {"status": "error", "message": "No drones registered"}

        bounds = SearchBounds(min_lat, min_lon, max_lat, max_lon)
        results = []

        for i, drone_id in enumerate(drone_ids):
            state = self._get_state(drone_id)
            if not self._set_mode(state, "GUIDED"):
                results.append({"drone_id": drone_id, "status": "error", "message": "Mode change failed"})
                continue

            waypoints = search_grid_waypoints(
                bounds, alt_m, pattern=pattern,
                drone_count=len(drone_ids), drone_index=i,
                swath_width_m=swath_width_m,
            )

            state.current_task = "searching"
            state._search_waypoints = waypoints
            state._search_index = 0

            if waypoints:
                wp = waypoints[0]
                self.goto(drone_id, wp.lat, wp.lon, wp.alt_m)

            results.append({
                "drone_id": drone_id,
                "status": "success",
                "waypoints": len(waypoints),
            })

        return {
            "status": "success",
            "message": f"{len(drone_ids)} drones searching area ({pattern} pattern)",
            "search": {
                "pattern": pattern,
                "bounds": {"min_lat": min_lat, "min_lon": min_lon, "max_lat": max_lat, "max_lon": max_lon},
            },
            "results": results,
        }

    def advance_search(self, drone_id: str, tolerance_m: float = 5.0) -> Optional[dict]:
        """
        Check if drone reached current search waypoint and advance to next.

        Call this periodically. Returns None if no action needed.
        """
        try:
            state = self._get_state(drone_id)
        except KeyError:
            return None

        if state.current_task != "searching":
            return None

        wps = getattr(state, '_search_waypoints', None)
        if not wps:
            return None

        idx = getattr(state, '_search_index', 0)
        if idx >= len(wps):
            state.current_task = "hovering"
            return {"status": "search_complete"}

        wp = wps[idx]
        from .formations import _haversine_m
        dist = _haversine_m(state.lat, state.lon, wp.lat, wp.lon)

        if dist <= tolerance_m:
            next_idx = idx + 1
            if next_idx >= len(wps):
                state.current_task = "hovering"
                logger.info(f"{drone_id}: Search complete ({len(wps)} waypoints)")
                return {"status": "search_complete", "waypoints_visited": len(wps)}

            state._search_index = next_idx
            next_wp = wps[next_idx]
            self.goto(drone_id, next_wp.lat, next_wp.lon, next_wp.alt_m)
            return {"status": "advancing", "waypoint": next_idx, "of": len(wps)}

        return None

    def broadcast(self, command: str, **kwargs) -> dict:
        """Send command to all registered drones."""
        logger.info(f"Broadcast: {command}")

        results = []
        drone_ids = self.registry.list_drones()

        for drone_id in drone_ids:
            try:
                if command == "takeoff":
                    result = self.takeoff(drone_id, **kwargs)
                elif command == "land":
                    result = self.land(drone_id)
                elif command == "return_home":
                    result = self.return_home(drone_id)
                elif command == "emergency_stop":
                    result = self.emergency_stop(drone_id)
                else:
                    result = {"status": "error", "message": f"Unknown command: {command}", "drone_id": drone_id}
                results.append(result)
            except Exception as e:
                results.append({"status": "error", "message": str(e), "drone_id": drone_id})

        return {
            "status": "success",
            "message": f"Broadcast '{command}' to {len(drone_ids)} drones",
            "results": results,
        }
