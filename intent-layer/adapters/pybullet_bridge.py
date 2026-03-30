#!/usr/bin/env python3
"""
PyBullet Bridge for AutoM8te Intent Layer

Receives JSON commands from Node.js, executes in gym-pybullet-drones,
returns JSON responses.

Usage: This script is spawned by pybullet.js adapter.
"""

import sys
import json
import numpy as np
from typing import Dict, Any, Optional

# Try to import gym-pybullet-drones
try:
    from gym_pybullet_drones.envs import CtrlAviary
    from gym_pybullet_drones.utils.enums import DroneModel, Physics
    from gym_pybullet_drones.control import DSLPIDControl
except ImportError:
    print(json.dumps({
        "id": 0,
        "error": "gym-pybullet-drones not installed. Run: pip install gym-pybullet-drones"
    }))
    sys.exit(1)


class PyBulletBridge:
    def __init__(self):
        self.env: Optional[CtrlAviary] = None
        self.controllers: Dict[int, DSLPIDControl] = {}
        self.targets: Dict[int, np.ndarray] = {}
        self.home_positions: Dict[int, np.ndarray] = {}
        self.num_drones = 0
        
    def init(self, num_drones: int = 4, gui: bool = False, freq: int = 240) -> Dict:
        """Initialize the environment"""
        self.num_drones = num_drones
        
        # Initial positions in a circle
        initial_xyzs = np.array([
            [np.cos(i * 2 * np.pi / num_drones), 
             np.sin(i * 2 * np.pi / num_drones), 
             0.1]
            for i in range(num_drones)
        ])
        
        self.env = CtrlAviary(
            drone_model=DroneModel.CF2X,
            num_drones=num_drones,
            initial_xyzs=initial_xyzs,
            physics=Physics.PYB,
            freq=freq,
            gui=gui,
        )
        
        # Initialize controllers and home positions
        for i in range(num_drones):
            self.controllers[i] = DSLPIDControl(drone_model=DroneModel.CF2X)
            self.home_positions[i] = initial_xyzs[i].copy()
            self.targets[i] = initial_xyzs[i].copy()
        
        return {"status": "ok", "num_drones": num_drones}
    
    def get_states(self) -> Dict:
        """Get all drone states"""
        if not self.env:
            return {"error": "Not initialized"}
        
        obs, _, _, _, _ = self.env.step(np.zeros((self.num_drones, 4)))
        
        drones = []
        for i in range(self.num_drones):
            state = obs[i]
            pos = state[0:3]
            vel = state[10:13]
            rpy = state[7:10]
            
            drones.append({
                "id": f"drone{i}",
                "position": pos.tolist(),
                "velocity": vel.tolist(),
                "heading": float(rpy[2]),
                "armed": True,
                "offboard": True,
                "battery": 100 - i * 5,
                "status": "flying" if pos[2] > 0.1 else "idle"
            })
        
        return {"drones": drones}
    
    def get_state(self, drone_id: str) -> Dict:
        """Get single drone state"""
        states = self.get_states()
        for drone in states["drones"]:
            if drone["id"] == drone_id:
                return drone
        return {"error": f"Drone not found: {drone_id}"}
    
    def get_swarm_state(self) -> Dict:
        """Get swarm summary"""
        states = self.get_states()
        positions = [d["position"] for d in states["drones"]]
        centroid = np.mean(positions, axis=0).tolist()
        
        return {
            "drones": {d["id"]: d for d in states["drones"]},
            "count": len(states["drones"]),
            "formation": "none",
            "centroid": centroid
        }
    
    def _drone_index(self, drone_id: str) -> int:
        """Convert drone_id string to index"""
        if drone_id.startswith("drone"):
            return int(drone_id[5:])
        return int(drone_id)
    
    def takeoff(self, drone_id: str, altitude: float = 1.0, speed: float = 1.0) -> Dict:
        """Takeoff to specified altitude"""
        idx = self._drone_index(drone_id)
        current = self.targets[idx].copy()
        current[2] = altitude
        self.targets[idx] = current
        self._fly_to_targets(steps=int(altitude / speed * self.env.CTRL_FREQ))
        return {"status": "ok", "altitude": altitude}
    
    def land(self, drone_id: str, speed: float = 0.5) -> Dict:
        """Land the drone"""
        idx = self._drone_index(drone_id)
        current = self.targets[idx].copy()
        current[2] = 0.05
        self.targets[idx] = current
        self._fly_to_targets(steps=int(current[2] / speed * self.env.CTRL_FREQ))
        return {"status": "ok"}
    
    def goto(self, drone_id: str, x: float, y: float, z: float, 
             speed: float = 1.5, frame: str = 'earth') -> Dict:
        """Go to position"""
        idx = self._drone_index(drone_id)
        
        if frame == 'base_link':
            # Relative to current position
            current = self.targets[idx].copy()
            self.targets[idx] = current + np.array([x, y, z])
        else:
            # Absolute
            self.targets[idx] = np.array([x, y, z])
        
        # Estimate steps based on distance
        distance = np.linalg.norm(self.targets[idx] - self._get_position(idx))
        steps = max(10, int(distance / speed * self.env.CTRL_FREQ))
        self._fly_to_targets(steps=steps)
        
        return {"status": "ok", "position": self.targets[idx].tolist()}
    
    def hover(self, drone_id: str) -> Dict:
        """Hover in place"""
        idx = self._drone_index(drone_id)
        self.targets[idx] = self._get_position(idx)
        return {"status": "ok"}
    
    def rtl(self, drone_id: str, altitude: float = 1.0, speed: float = 1.0) -> Dict:
        """Return to launch"""
        idx = self._drone_index(drone_id)
        home = self.home_positions[idx].copy()
        home[2] = altitude
        self.targets[idx] = home
        self._fly_to_targets()
        
        # Then land
        home[2] = 0.05
        self.targets[idx] = home
        self._fly_to_targets()
        
        return {"status": "ok"}
    
    def emergency(self, drone_id: Optional[str] = None) -> Dict:
        """Emergency stop"""
        if drone_id:
            idx = self._drone_index(drone_id)
            self.targets[idx] = self._get_position(idx)
            self.targets[idx][2] = 0.05
        else:
            for i in range(self.num_drones):
                self.targets[i] = self._get_position(i)
                self.targets[i][2] = 0.05
        
        self._fly_to_targets(steps=50)
        return {"status": "emergency"}
    
    def follow_path(self, drone_id: str, waypoints: list, speed: float = 1.5) -> Dict:
        """Follow waypoint path"""
        idx = self._drone_index(drone_id)
        
        for wp in waypoints:
            self.targets[idx] = np.array(wp)
            distance = np.linalg.norm(self.targets[idx] - self._get_position(idx))
            steps = max(10, int(distance / speed * self.env.CTRL_FREQ))
            self._fly_to_targets(steps=steps)
        
        return {"status": "ok", "waypoints_completed": len(waypoints)}
    
    def set_formation(self, offsets: list) -> Dict:
        """Set formation from offsets"""
        centroid = np.mean([self._get_position(i) for i in range(self.num_drones)], axis=0)
        
        for offset_data in offsets:
            drone_id = offset_data["id"]
            offset = np.array(offset_data["offset"])
            idx = self._drone_index(drone_id)
            self.targets[idx] = centroid + offset
        
        self._fly_to_targets()
        return {"status": "ok"}
    
    def move_swarm(self, x: float, y: float, z: float, frame: str = 'earth') -> Dict:
        """Move entire swarm"""
        delta = np.array([x, y, z])
        
        for i in range(self.num_drones):
            if frame == 'base_link':
                self.targets[i] = self._get_position(i) + delta
            else:
                # Move to position relative to current centroid
                centroid = np.mean([self._get_position(j) for j in range(self.num_drones)], axis=0)
                offset = self._get_position(i) - centroid
                self.targets[i] = np.array([x, y, z]) + offset
        
        self._fly_to_targets()
        return {"status": "ok"}
    
    def step(self, actions: Optional[dict] = None) -> Dict:
        """Step the simulation"""
        if actions:
            # Actions provided as RPM commands
            action_array = np.array([actions.get(f"drone{i}", [0, 0, 0, 0]) 
                                    for i in range(self.num_drones)])
        else:
            # Use PID to fly to targets
            action_array = self._compute_control()
        
        obs, reward, terminated, truncated, info = self.env.step(action_array)
        
        return {
            "observations": obs.tolist() if isinstance(obs, np.ndarray) else obs,
            "reward": float(reward) if isinstance(reward, (int, float)) else reward,
            "done": bool(terminated) if isinstance(terminated, bool) else any(terminated),
        }
    
    def reset(self) -> Dict:
        """Reset the environment"""
        obs, info = self.env.reset()
        
        # Reset targets to initial positions
        for i in range(self.num_drones):
            self.targets[i] = self.home_positions[i].copy()
        
        return {"observations": obs.tolist() if isinstance(obs, np.ndarray) else obs}
    
    def get_observations(self) -> Dict:
        """Get current observations without stepping"""
        states = self.get_states()
        return {"observations": states["drones"]}
    
    def get_camera(self, drone_id: str, camera_type: str = 'rgb') -> Dict:
        """Get camera image from drone"""
        # This requires VisionAviary - stub for now
        return {"error": "Camera capture requires VisionAviary (not implemented)"}
    
    def shutdown(self) -> Dict:
        """Shutdown the environment"""
        if self.env:
            self.env.close()
        return {"status": "shutdown"}
    
    def _get_position(self, idx: int) -> np.ndarray:
        """Get current position of drone"""
        obs, _, _, _, _ = self.env.step(np.zeros((self.num_drones, 4)))
        return obs[idx][0:3].copy()
    
    def _compute_control(self) -> np.ndarray:
        """Compute PID control for all drones to reach targets"""
        obs, _, _, _, _ = self.env.step(np.zeros((self.num_drones, 4)))
        
        actions = np.zeros((self.num_drones, 4))
        for i in range(self.num_drones):
            action, _, _ = self.controllers[i].computeControlFromState(
                control_timestep=self.env.CTRL_TIMESTEP,
                state=obs[i],
                target_pos=self.targets[i],
            )
            actions[i] = action
        
        return actions
    
    def _fly_to_targets(self, steps: int = 100) -> None:
        """Execute control to fly to targets"""
        for _ in range(steps):
            actions = self._compute_control()
            self.env.step(actions)


def main():
    bridge = PyBulletBridge()
    
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        
        try:
            request = json.loads(line)
            cmd = request.get("cmd")
            request_id = request.get("id", 0)
            
            # Remove 'cmd' and 'id' from kwargs
            kwargs = {k: v for k, v in request.items() if k not in ("cmd", "id")}
            
            # Dispatch command
            if hasattr(bridge, cmd):
                result = getattr(bridge, cmd)(**kwargs)
            else:
                result = {"error": f"Unknown command: {cmd}"}
            
            response = {"id": request_id, "result": result}
            
        except Exception as e:
            response = {"id": request.get("id", 0), "error": str(e)}
        
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
