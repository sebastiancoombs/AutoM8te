"""
Swarm Manager - Core orchestration for multi-drone coordination.
"""

from typing import Dict, List, Optional
import logging

from .drone import Drone, DroneState, Position, Orientation, Velocity

logger = logging.getLogger(__name__)


class SwarmManager:
    """
    Manages multiple drones, routes commands, handles collision avoidance.
    """
    
    MIN_SEPARATION_DISTANCE = 5.0  # meters
    
    def __init__(self):
        self.drones: Dict[str, Drone] = {}
        self.object_registry: Dict[str, dict] = {}  # Track detected objects
        
    def register_drone(self, drone_id: str, name: Optional[str] = None) -> Drone:
        """Add a drone to the swarm"""
        if drone_id in self.drones:
            logger.warning(f"Drone {drone_id} already registered")
            return self.drones[drone_id]
            
        drone = Drone(drone_id, name)
        self.drones[drone_id] = drone
        logger.info(f"Registered {drone.name} (ID: {drone_id})")
        return drone
        
    def get_drone(self, drone_id: str) -> Optional[Drone]:
        """Get drone by ID"""
        return self.drones.get(drone_id)
        
    def get_all_drones(self) -> List[Drone]:
        """Get all registered drones"""
        return list(self.drones.values())
        
    def get_active_drones(self) -> List[Drone]:
        """Get all active (airborne) drones"""
        return [d for d in self.drones.values() if d.is_active()]
        
    def update_drone_telemetry(
        self,
        drone_id: str,
        position: Position,
        orientation: Orientation,
        velocity: Velocity
    ):
        """Update telemetry for a specific drone"""
        drone = self.get_drone(drone_id)
        if not drone:
            logger.error(f"Cannot update telemetry: drone {drone_id} not found")
            return
            
        drone.update_telemetry(position, orientation, velocity)
        
        # Check for collision risks after update
        self._check_collision_risks(drone)
        
    def _check_collision_risks(self, drone: Drone):
        """
        Check if drone is too close to any other active drone.
        Mark both drones if collision risk detected.
        """
        if not drone.is_active():
            return
            
        for other in self.get_active_drones():
            if other.id == drone.id:
                continue
                
            distance = self._calculate_distance(drone.position, other.position)
            
            if distance < self.MIN_SEPARATION_DISTANCE:
                drone.is_collision_risk = True
                other.is_collision_risk = True
                logger.warning(
                    f"Collision risk: {drone.name} and {other.name} "
                    f"within {distance:.1f}m (min: {self.MIN_SEPARATION_DISTANCE}m)"
                )
            else:
                # Clear risk flag if separation is now safe
                if drone.is_collision_risk:
                    drone.is_collision_risk = False
                    logger.info(f"Collision risk cleared for {drone.name}")
                    
    def _calculate_distance(self, pos1: Position, pos2: Position) -> float:
        """Calculate Euclidean distance between two positions"""
        dx = pos1.x - pos2.x
        dy = pos1.y - pos2.y
        dz = pos1.z - pos2.z
        return (dx**2 + dy**2 + dz**2) ** 0.5
        
    def register_object(self, object_id: str, class_name: str, position: Position):
        """Register a detected object (from YOLO)"""
        self.object_registry[object_id] = {
            "class": class_name,
            "position": position,
            "last_seen": None  # Will use time.time() when implemented
        }
        
    def get_object(self, object_id: str) -> Optional[dict]:
        """Get tracked object by ID"""
        return self.object_registry.get(object_id)
        
    def find_objects_by_class(self, class_name: str) -> List[str]:
        """Find all tracked objects of a given class"""
        return [
            obj_id for obj_id, obj in self.object_registry.items()
            if obj["class"] == class_name
        ]
        
    def status_summary(self) -> dict:
        """Get summary of swarm status"""
        return {
            "total_drones": len(self.drones),
            "active_drones": len(self.get_active_drones()),
            "grounded_drones": len([d for d in self.drones.values() if d.state == DroneState.GROUNDED]),
            "collision_risks": len([d for d in self.drones.values() if d.is_collision_risk]),
            "tracked_objects": len(self.object_registry),
        }
