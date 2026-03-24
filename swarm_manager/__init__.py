"""
AutoM8te Swarm Manager

Voice-controlled drone swarm system.
Backend: pymavlink → ArduPilot SITL / real hardware.
"""

from .drone_registry import DroneRegistry, DroneState
from .command_router import CommandRouter
from .formations import get_formation, assign_drones_to_slots, FORMATIONS
from .tools import DroneTools

__version__ = "0.9.0"
__all__ = [
    "DroneRegistry",
    "DroneState",
    "CommandRouter",
    "DroneTools",
    "get_formation",
    "assign_drones_to_slots",
    "FORMATIONS",
]
