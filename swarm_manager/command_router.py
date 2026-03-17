"""
Command Router - Translates high-level commands into MAVSDK actions.

Routes commands from OpenClaw MCP tools to appropriate MAVSDK calls.
"""

import logging
from typing import Optional
from .drone_registry import DroneRegistry

logger = logging.getLogger(__name__)


class CommandRouter:
    """
    Routes commands to drones via MAVSDK.
    
    Provides high-level commands (takeoff, move, land) that abstract
    MAVSDK complexity and add safety checks.
    """
    
    def __init__(self, registry: DroneRegistry):
        self.registry = registry
        logger.info("CommandRouter initialized")
    
    async def takeoff(self, drone_id: str, altitude_m: float = 5.0):
        """
        Command drone to take off to specified altitude.
        
        Args:
            drone_id: Target drone ID
            altitude_m: Target altitude in meters (default: 5.0)
        
        Returns:
            dict with status and message
        """
        logger.info(f"{drone_id}: Takeoff command received (altitude: {altitude_m}m)")
        
        try:
            state = self.registry.get_drone(drone_id)
            drone = state.mavsdk
            
            # Set takeoff altitude
            await drone.action.set_takeoff_altitude(altitude_m)
            
            # Arm the drone
            logger.info(f"{drone_id}: Arming...")
            await drone.action.arm()
            state.is_armed = True
            
            # Execute takeoff
            logger.info(f"{drone_id}: Taking off to {altitude_m}m...")
            await drone.action.takeoff()
            state.current_task = "takeoff"
            
            return {
                "status": "success",
                "message": f"{drone_id} taking off to {altitude_m}m",
                "drone_id": drone_id,
                "altitude_m": altitude_m
            }
        
        except Exception as e:
            logger.error(f"{drone_id}: Takeoff failed: {e}")
            return {
                "status": "error",
                "message": f"Takeoff failed: {str(e)}",
                "drone_id": drone_id
            }
    
    async def land(self, drone_id: str):
        """
        Command drone to land at current position.
        
        Args:
            drone_id: Target drone ID
        
        Returns:
            dict with status and message
        """
        logger.info(f"{drone_id}: Land command received")
        
        try:
            state = self.registry.get_drone(drone_id)
            drone = state.mavsdk
            
            # Execute landing
            logger.info(f"{drone_id}: Landing...")
            await drone.action.land()
            state.current_task = "landing"
            
            return {
                "status": "success",
                "message": f"{drone_id} landing",
                "drone_id": drone_id
            }
        
        except Exception as e:
            logger.error(f"{drone_id}: Land failed: {e}")
            return {
                "status": "error",
                "message": f"Land failed: {str(e)}",
                "drone_id": drone_id
            }
    
    async def move_ned(
        self,
        drone_id: str,
        north_m: float,
        east_m: float,
        down_m: float,
        yaw_deg: float = 0.0
    ):
        """
        Move drone to NED (North-East-Down) coordinates.
        
        Coordinates are relative to home position.
        
        Args:
            drone_id: Target drone ID
            north_m: Meters north of home (positive = north)
            east_m: Meters east of home (positive = east)
            down_m: Meters down from home (negative = up, e.g., -10 = 10m altitude)
            yaw_deg: Target yaw in degrees (0-360, optional)
        
        Returns:
            dict with status and message
        """
        logger.info(f"{drone_id}: Move NED command received (N:{north_m}, E:{east_m}, D:{down_m}, Yaw:{yaw_deg})")
        
        try:
            state = self.registry.get_drone(drone_id)
            drone = state.mavsdk
            
            # Send goto command
            logger.info(f"{drone_id}: Moving to NED position...")
            await drone.action.goto_location(north_m, east_m, down_m, yaw_deg)
            state.current_task = "flying"
            
            return {
                "status": "success",
                "message": f"{drone_id} moving to N:{north_m}, E:{east_m}, D:{down_m}",
                "drone_id": drone_id,
                "target": {"north": north_m, "east": east_m, "down": down_m, "yaw": yaw_deg}
            }
        
        except Exception as e:
            logger.error(f"{drone_id}: Move NED failed: {e}")
            return {
                "status": "error",
                "message": f"Move NED failed: {str(e)}",
                "drone_id": drone_id
            }
    
    async def set_velocity(
        self,
        drone_id: str,
        vx_ms: float,
        vy_ms: float,
        vz_ms: float,
        yaw_rate_degs: float = 0.0
    ):
        """
        Set drone velocity vector (NED frame).
        
        Args:
            drone_id: Target drone ID
            vx_ms: North velocity in m/s
            vy_ms: East velocity in m/s
            vz_ms: Down velocity in m/s (negative = climb)
            yaw_rate_degs: Yaw rate in degrees/second (optional)
        
        Returns:
            dict with status and message
        """
        logger.info(f"{drone_id}: Set velocity command received (Vx:{vx_ms}, Vy:{vy_ms}, Vz:{vz_ms}, YawRate:{yaw_rate_degs})")
        
        try:
            state = self.registry.get_drone(drone_id)
            drone = state.mavsdk
            
            # Enable offboard mode if not already enabled
            # (Required for velocity commands)
            # TODO: Check if already in offboard mode
            
            # Set velocity
            logger.info(f"{drone_id}: Setting velocity...")
            await drone.offboard.set_velocity_ned(
                vx_ms, vy_ms, vz_ms, yaw_rate_degs
            )
            
            # Start offboard mode
            await drone.offboard.start()
            state.current_task = "flying"
            
            return {
                "status": "success",
                "message": f"{drone_id} velocity set",
                "drone_id": drone_id,
                "velocity": {"vx": vx_ms, "vy": vy_ms, "vz": vz_ms, "yaw_rate": yaw_rate_degs}
            }
        
        except Exception as e:
            logger.error(f"{drone_id}: Set velocity failed: {e}")
            return {
                "status": "error",
                "message": f"Set velocity failed: {str(e)}",
                "drone_id": drone_id
            }
    
    async def return_home(self, drone_id: str):
        """
        Command drone to return to launch position and land.
        
        Args:
            drone_id: Target drone ID
        
        Returns:
            dict with status and message
        """
        logger.info(f"{drone_id}: Return home command received")
        
        try:
            state = self.registry.get_drone(drone_id)
            drone = state.mavsdk
            
            # Execute return to launch (RTL)
            logger.info(f"{drone_id}: Returning to home...")
            await drone.action.return_to_launch()
            state.current_task = "returning_home"
            
            return {
                "status": "success",
                "message": f"{drone_id} returning to home position",
                "drone_id": drone_id
            }
        
        except Exception as e:
            logger.error(f"{drone_id}: Return home failed: {e}")
            return {
                "status": "error",
                "message": f"Return home failed: {str(e)}",
                "drone_id": drone_id
            }
    
    async def broadcast(self, command: str, **kwargs):
        """
        Send command to all registered drones.
        
        Args:
            command: Command name (takeoff, land, return_home)
            **kwargs: Command-specific arguments
        
        Returns:
            dict with list of results from each drone
        """
        logger.info(f"Broadcast command: {command}")
        
        results = []
        drone_ids = self.registry.list_drones()
        
        for drone_id in drone_ids:
            try:
                if command == "takeoff":
                    result = await self.takeoff(drone_id, **kwargs)
                elif command == "land":
                    result = await self.land(drone_id)
                elif command == "return_home":
                    result = await self.return_home(drone_id)
                else:
                    result = {
                        "status": "error",
                        "message": f"Unknown command: {command}",
                        "drone_id": drone_id
                    }
                results.append(result)
            except Exception as e:
                logger.error(f"Broadcast to {drone_id} failed: {e}")
                results.append({
                    "status": "error",
                    "message": str(e),
                    "drone_id": drone_id
                })
        
        return {
            "status": "success",
            "message": f"Broadcast '{command}' to {len(drone_ids)} drones",
            "results": results
        }
