"""
AutoM8te Swarm Manager

Core orchestration layer for multi-drone coordination.
Manages drone registry, command routing, collision avoidance, and object tracking.
"""

from .manager import SwarmManager
from .drone import Drone, DroneState

__all__ = ["SwarmManager", "Drone", "DroneState"]
