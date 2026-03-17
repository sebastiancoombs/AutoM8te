"""
Drone state representation and telemetry tracking.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional
import time


class DroneState(Enum):
    """Possible drone states"""
    GROUNDED = "grounded"
    TAKING_OFF = "taking_off"
    HOVERING = "hovering"
    MOVING = "moving"
    LANDING = "landing"
    TRACKING = "tracking"  # Following an object
    COLLISION_AVOIDANCE = "collision_avoidance"
    ERROR = "error"


@dataclass
class Position:
    """3D position in NED (North-East-Down) coordinates"""
    x: float  # North (meters)
    y: float  # East (meters)
    z: float  # Down (meters, negative = altitude)


@dataclass
class Orientation:
    """Drone orientation (Euler angles in radians)"""
    roll: float
    pitch: float
    yaw: float


@dataclass
class Velocity:
    """Velocity vector (m/s)"""
    vx: float
    vy: float
    vz: float


class Drone:
    """
    Represents a single drone in the swarm.
    Tracks state, telemetry, and current task.
    """
    
    def __init__(self, drone_id: str, name: Optional[str] = None):
        self.id = drone_id
        self.name = name or f"Drone {drone_id}"
        self.state = DroneState.GROUNDED
        
        # Telemetry
        self.position = Position(0.0, 0.0, 0.0)
        self.orientation = Orientation(0.0, 0.0, 0.0)
        self.velocity = Velocity(0.0, 0.0, 0.0)
        
        # Task tracking
        self.current_task: Optional[str] = None
        self.tracking_object_id: Optional[str] = None
        
        # Status
        self.is_collision_risk = False
        self.last_update = time.time()
        
    def update_telemetry(
        self,
        position: Position,
        orientation: Orientation,
        velocity: Velocity
    ):
        """Update drone telemetry from AirSim"""
        self.position = position
        self.orientation = orientation
        self.velocity = velocity
        self.last_update = time.time()
        
    def set_state(self, state: DroneState):
        """Update drone state"""
        self.state = state
        
    def assign_task(self, task: str):
        """Assign a task to this drone"""
        self.current_task = task
        
    def clear_task(self):
        """Clear current task"""
        self.current_task = None
        self.tracking_object_id = None
        
    def is_active(self) -> bool:
        """Check if drone is airborne and active"""
        return self.state not in [DroneState.GROUNDED, DroneState.ERROR]
        
    def __repr__(self) -> str:
        return f"<Drone {self.name} | State: {self.state.value} | Pos: ({self.position.x:.1f}, {self.position.y:.1f}, {self.position.z:.1f})>"
