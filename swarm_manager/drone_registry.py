"""
Drone Registry - Centralized state management for all drones in the swarm.

Manages MAVSDK connections, telemetry, and drone state tracking.
"""

from dataclasses import dataclass, field
from typing import Optional
import asyncio
import logging

try:
    from mavsdk import System
    from mavsdk.telemetry import Position, EulerAngle
except ImportError:
    # Allow import without MAVSDK installed (for testing/development)
    System = None
    Position = None
    EulerAngle = None

logger = logging.getLogger(__name__)


@dataclass
class DroneState:
    """State container for a single drone."""
    
    id: str  # drone_1, drone_2, etc.
    mavsdk: Optional[object] = None  # MAVSDK System instance
    connection_string: str = ""  # e.g., "udp://:14550"
    
    # Telemetry
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)  # (north, east, down) in meters
    orientation: tuple[float, float, float] = (0.0, 0.0, 0.0)  # (roll, pitch, yaw) in degrees
    altitude_m: float = 0.0  # Altitude above home position
    battery_percent: float = 100.0
    
    # Mission state
    tracking_object_id: Optional[str] = None  # Object being tracked (from YOLO)
    current_task: str = "idle"  # idle, takeoff, flying, tracking, landing
    
    # Safety
    collision_risk: bool = False  # Set by collision avoidance system
    is_armed: bool = False
    is_connected: bool = False


class DroneRegistry:
    """
    Centralized registry for all drones in the swarm.
    
    Manages MAVSDK connections, telemetry updates, and state queries.
    """
    
    def __init__(self):
        self.drones: dict[str, DroneState] = {}
        self._telemetry_tasks: dict[str, asyncio.Task] = {}
        logger.info("DroneRegistry initialized")
    
    async def register(self, drone_id: str, connection_string: str):
        """
        Register a new drone and establish MAVSDK connection.
        
        Args:
            drone_id: Unique identifier (e.g., "drone_1")
            connection_string: MAVSDK connection string (e.g., "udp://:14550")
        """
        if System is None:
            logger.error("MAVSDK not installed. Cannot register drone.")
            raise RuntimeError("MAVSDK-Python not installed")
        
        logger.info(f"Registering {drone_id} at {connection_string}")
        
        # Create MAVSDK system
        drone = System()
        await drone.connect(system_address=connection_string)
        
        # Wait for connection (timeout after 10 seconds)
        logger.info(f"Waiting for {drone_id} to connect...")
        async for state in drone.core.connection_state():
            if state.is_connected:
                logger.info(f"{drone_id} connected successfully")
                break
        
        # Create state container
        state = DroneState(
            id=drone_id,
            mavsdk=drone,
            connection_string=connection_string,
            is_connected=True
        )
        
        self.drones[drone_id] = state
        
        # Start telemetry monitoring task
        task = asyncio.create_task(self._monitor_telemetry(drone_id))
        self._telemetry_tasks[drone_id] = task
        
        logger.info(f"{drone_id} registered and telemetry monitoring started")
    
    async def _monitor_telemetry(self, drone_id: str):
        """
        Background task to continuously monitor drone telemetry.
        
        Updates position, orientation, altitude, battery in real-time.
        """
        drone = self.drones[drone_id].mavsdk
        
        try:
            # Subscribe to position updates
            async for position in drone.telemetry.position():
                state = self.drones[drone_id]
                state.position = (
                    position.latitude_deg,
                    position.longitude_deg,
                    position.absolute_altitude_m
                )
                state.altitude_m = position.relative_altitude_m
            
            # Subscribe to attitude updates
            async for attitude in drone.telemetry.attitude_euler():
                state = self.drones[drone_id]
                state.orientation = (
                    attitude.roll_deg,
                    attitude.pitch_deg,
                    attitude.yaw_deg
                )
            
            # Subscribe to battery updates
            async for battery in drone.telemetry.battery():
                state = self.drones[drone_id]
                state.battery_percent = battery.remaining_percent
        
        except asyncio.CancelledError:
            logger.info(f"Telemetry monitoring stopped for {drone_id}")
        except Exception as e:
            logger.error(f"Telemetry error for {drone_id}: {e}")
    
    def get_drone(self, drone_id: str) -> DroneState:
        """Get drone state by ID."""
        if drone_id not in self.drones:
            raise KeyError(f"Drone {drone_id} not registered")
        return self.drones[drone_id]
    
    def list_drones(self) -> list[str]:
        """Get list of all registered drone IDs."""
        return list(self.drones.keys())
    
    def get_telemetry(self, drone_id: str) -> dict:
        """
        Get current telemetry snapshot for a drone.
        
        Returns:
            dict with position, orientation, altitude, battery, etc.
        """
        state = self.get_drone(drone_id)
        return {
            "drone_id": state.id,
            "connected": state.is_connected,
            "armed": state.is_armed,
            "position": {
                "north": state.position[0],
                "east": state.position[1],
                "down": state.position[2]
            },
            "orientation": {
                "roll": state.orientation[0],
                "pitch": state.orientation[1],
                "yaw": state.orientation[2]
            },
            "altitude_m": state.altitude_m,
            "battery_percent": state.battery_percent,
            "current_task": state.current_task,
            "tracking_object": state.tracking_object_id,
            "collision_risk": state.collision_risk
        }
    
    async def shutdown(self):
        """Clean shutdown - cancel all telemetry tasks."""
        logger.info("Shutting down DroneRegistry...")
        for task in self._telemetry_tasks.values():
            task.cancel()
        await asyncio.gather(*self._telemetry_tasks.values(), return_exceptions=True)
        logger.info("DroneRegistry shutdown complete")
