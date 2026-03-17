"""
AirSim Bridge - Interface between Swarm Manager and AirSim simulation.

Handles:
- Connection to AirSim
- Drone control commands (takeoff, move, land)
- Telemetry updates
- Camera feed access
"""

import airsim
import logging
from typing import Optional, List
import time

from swarm_manager import SwarmManager, Position, Orientation, Velocity, DroneState

logger = logging.getLogger(__name__)


class AirSimBridge:
    """
    Bridge between SwarmManager and AirSim Python API.
    Translates high-level commands to AirSim API calls.
    """
    
    def __init__(self, swarm_manager: SwarmManager, host: str = "127.0.0.1"):
        self.swarm = swarm_manager
        self.host = host
        self.client: Optional[airsim.MultirotorClient] = None
        self.connected = False
        
    def connect(self) -> bool:
        """Establish connection to AirSim"""
        try:
            logger.info(f"Connecting to AirSim at {self.host}...")
            self.client = airsim.MultirotorClient(ip=self.host)
            self.client.confirmConnection()
            logger.info("✓ Connected to AirSim")
            self.connected = True
            return True
        except Exception as e:
            logger.error(f"✗ Failed to connect to AirSim: {e}")
            self.connected = False
            return False
            
    def enable_api_control(self, drone_id: str):
        """Enable API control for a specific drone"""
        if not self.connected:
            raise RuntimeError("Not connected to AirSim")
        self.client.enableApiControl(True, vehicle_name=drone_id)
        logger.info(f"API control enabled for {drone_id}")
        
    def arm_drone(self, drone_id: str):
        """Arm drone motors"""
        if not self.connected:
            raise RuntimeError("Not connected to AirSim")
        self.client.armDisarm(True, vehicle_name=drone_id)
        logger.info(f"Armed {drone_id}")
        
    def takeoff(self, drone_id: str, timeout: float = 10.0):
        """Command drone to take off"""
        if not self.connected:
            raise RuntimeError("Not connected to AirSim")
            
        drone = self.swarm.get_drone(drone_id)
        if not drone:
            raise ValueError(f"Drone {drone_id} not registered")
            
        drone.set_state(DroneState.TAKING_OFF)
        self.client.takeoffAsync(timeout_sec=timeout, vehicle_name=drone_id).join()
        drone.set_state(DroneState.HOVERING)
        logger.info(f"{drone.name} took off")
        
    def land(self, drone_id: str, timeout: float = 10.0):
        """Command drone to land"""
        if not self.connected:
            raise RuntimeError("Not connected to AirSim")
            
        drone = self.swarm.get_drone(drone_id)
        if not drone:
            raise ValueError(f"Drone {drone_id} not registered")
            
        drone.set_state(DroneState.LANDING)
        self.client.landAsync(timeout_sec=timeout, vehicle_name=drone_id).join()
        drone.set_state(DroneState.GROUNDED)
        logger.info(f"{drone.name} landed")
        
    def move_to_position(
        self,
        drone_id: str,
        x: float,
        y: float,
        z: float,
        velocity: float = 5.0
    ):
        """
        Move drone to absolute position (NED coordinates).
        z is negative (altitude above ground).
        """
        if not self.connected:
            raise RuntimeError("Not connected to AirSim")
            
        drone = self.swarm.get_drone(drone_id)
        if not drone:
            raise ValueError(f"Drone {drone_id} not registered")
            
        drone.set_state(DroneState.MOVING)
        self.client.moveToPositionAsync(
            x, y, z,
            velocity,
            vehicle_name=drone_id
        ).join()
        drone.set_state(DroneState.HOVERING)
        logger.info(f"{drone.name} moved to ({x:.1f}, {y:.1f}, {z:.1f})")
        
    def hover(self, drone_id: str):
        """Command drone to hover in place"""
        if not self.connected:
            raise RuntimeError("Not connected to AirSim")
            
        drone = self.swarm.get_drone(drone_id)
        if not drone:
            raise ValueError(f"Drone {drone_id} not registered")
            
        self.client.hoverAsync(vehicle_name=drone_id).join()
        drone.set_state(DroneState.HOVERING)
        logger.info(f"{drone.name} hovering")
        
    def update_telemetry(self, drone_id: str):
        """
        Fetch current telemetry from AirSim and update Swarm Manager.
        Should be called periodically (e.g., 10 Hz).
        """
        if not self.connected:
            return
            
        drone = self.swarm.get_drone(drone_id)
        if not drone:
            return
            
        # Get state from AirSim
        state = self.client.getMultirotorState(vehicle_name=drone_id)
        
        # Extract position (NED)
        pos = state.kinematics_estimated.position
        position = Position(pos.x_val, pos.y_val, pos.z_val)
        
        # Extract orientation (Euler angles)
        ori = state.kinematics_estimated.orientation
        pitch, roll, yaw = airsim.to_eularian_angles(ori)
        orientation = Orientation(roll, pitch, yaw)
        
        # Extract velocity
        vel = state.kinematics_estimated.linear_velocity
        velocity = Velocity(vel.x_val, vel.y_val, vel.z_val)
        
        # Update Swarm Manager
        self.swarm.update_drone_telemetry(drone_id, position, orientation, velocity)
        
    def update_all_telemetry(self):
        """Update telemetry for all registered drones"""
        for drone_id in self.swarm.drones.keys():
            self.update_telemetry(drone_id)
            
    def get_camera_image(self, drone_id: str, camera_name: str = "0") -> Optional[bytes]:
        """
        Get RGB camera image from drone.
        Returns raw PNG bytes.
        """
        if not self.connected:
            return None
            
        responses = self.client.simGetImages([
            airsim.ImageRequest(camera_name, airsim.ImageType.Scene, False, False)
        ], vehicle_name=drone_id)
        
        if responses:
            return responses[0].image_data_uint8
        return None
        
    def reset(self):
        """Reset AirSim simulation"""
        if self.connected:
            self.client.reset()
            logger.info("AirSim simulation reset")
