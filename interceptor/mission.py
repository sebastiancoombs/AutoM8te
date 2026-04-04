"""
Interceptor Mission Controller

Coordinates the full intercept loop:
1. Detect enemy drones (from perception or simulated positions)
2. Assign interceptors to targets (Hungarian algorithm)
3. Each interceptor pursues its target (APN guidance)
4. On kill/loss, reassign
5. Report status to ground station

Each drone runs its own state machine. The coordinator
handles global decisions (assignment, reassignment).
"""

import time
import threading
import numpy as np
from transitions import Machine

from .assignment import assign_targets, compute_cost_matrix
from .pursuit import PursuitController, PredictiveIntercept
from .swarm_comms import SwarmBus, DroneComms


INTERCEPT_STATES = ["idle", "searching", "pursuing", "intercepted", "lost_target", "returning"]

INTERCEPT_TRANSITIONS = [
    {"trigger": "begin_search", "source": "idle", "dest": "searching"},
    {"trigger": "target_found", "source": ["idle", "searching", "lost_target", "intercepted"], "dest": "pursuing"},
    {"trigger": "target_lost", "source": "pursuing", "dest": "lost_target"},
    {"trigger": "intercept_complete", "source": "pursuing", "dest": "intercepted"},
    {"trigger": "return_home", "source": ["idle", "intercepted", "lost_target"], "dest": "returning"},
    {"trigger": "go_idle", "source": "*", "dest": "idle"},
]


class InterceptorDrone:
    """
    State machine for a single interceptor drone.
    """

    def __init__(self, drone_id: str, comms: DroneComms, vehicle=None):
        self.drone_id = drone_id
        self.comms = comms
        self.vehicle = vehicle  # DroneKit vehicle or None for sim

        self.machine = Machine(
            model=self,
            states=INTERCEPT_STATES,
            transitions=INTERCEPT_TRANSITIONS,
            initial="idle",
        )
        self.assigned_target = None
        self.pursuit = PursuitController(nav_gain=6.0, max_accel=10.0)
        self.predictor = PredictiveIntercept(max_speed=25.0)

        self.position = np.zeros(3)
        self.velocity = np.zeros(3)

        # Intercept threshold (meters)
        self.intercept_radius = 5.0

        # Lost target timeout (seconds)
        self.lost_timeout = 5.0
        self.last_target_seen = None

        # Listen for swarm messages
        self.comms.listen("reassign", self._on_reassign)
        self.comms.listen("target_killed", self._on_target_killed)

    def assign_target(self, target_id: str):
        """Assign a new target to pursue."""
        if self.assigned_target != target_id:
            self.pursuit.reset()  # Fresh pursuit for new target
        self.assigned_target = target_id
        # Only trigger state change if not already pursuing
        if self.state != "pursuing":
            self.target_found()
        self.last_target_seen = time.time()

    def tick(self, own_state: dict, target_states: dict, dt: float = 0.1):
        """
        Main update loop. Call every tick (~10-20 Hz).
        
        Args:
            own_state: {"position": [x,y,z], "velocity": [vx,vy,vz]}
            target_states: {target_id: {"position": [...], "velocity": [...]}}
            dt: time step
            
        Returns:
            accel_cmd: np.array [ax, ay, az] or None if no action
            info: dict with status info
        """
        self.position = np.array(own_state["position"])
        self.velocity = np.array(own_state["velocity"])

        # Broadcast position periodically
        self.comms.send_position(
            self.position.tolist(),
            self.velocity.tolist(),
            self.state,
        )

        if self.state == "idle":
            return None, {"state": "idle"}

        if self.state == "pursuing":
            return self._pursue(target_states, dt)

        if self.state == "lost_target":
            # Fly to last known position
            if self.last_target_seen and (time.time() - self.last_target_seen) > self.lost_timeout:
                self.go_idle()
                self.comms.send_target_lost(
                    self.assigned_target,
                    self.position.tolist(),
                )
                return None, {"state": "lost_timeout", "target": self.assigned_target}
            return None, {"state": "searching_last_known"}

        if self.state == "intercepted":
            return None, {"state": "intercepted", "target": self.assigned_target}

        return None, {"state": self.state}

    def _pursue(self, target_states, dt):
        """Execute pursuit of assigned target."""
        if self.assigned_target not in target_states:
            # Target not visible
            if self.last_target_seen:
                self.target_lost()
            return None, {"state": "target_not_visible", "target": self.assigned_target}

        target = target_states[self.assigned_target]
        target_pos = np.array(target["position"])
        target_vel = np.array(target["velocity"])
        self.last_target_seen = time.time()

        # Check if intercepted
        distance = np.linalg.norm(target_pos - self.position)
        if distance < self.intercept_radius:
            self.intercept_complete()
            self.comms.send_target_killed(self.assigned_target)
            return None, {
                "state": "intercepted",
                "target": self.assigned_target,
                "distance": distance,
            }

        # Hybrid pursuit: predictive intercept when far, APN when close
        target_accel = None
        if len(self.pursuit.target_history) >= 3:
            target_accel = self.pursuit._estimate_target_accel(target_pos, target_vel, dt)

        intercept_point, eti = self.predictor.compute_intercept_point(
            self.position, target_pos, target_vel, target_accel,
        )

        # Hybrid pursuit: predictive → lead pursuit (not pure pursuit)
        # Pure pursuit fails against maneuvering targets — need lead aiming
        if distance > 35.0:
            # Far: Fly to predicted intercept point (command guidance)
            to_intercept = intercept_point - self.position
            accel_cmd = to_intercept / np.linalg.norm(to_intercept) * 10.0
            pursuit_mode = "predictive"
            pursuit_info = {"closing_speed": np.dot(self.velocity, to_intercept / np.linalg.norm(to_intercept))}
        else:
            # Close-in: Aggressive lead pursuit with curved trajectory prediction
            # Time to intercept estimate (iterative refinement)
            speed_ratio = np.linalg.norm(self.velocity) / max(np.linalg.norm(target_vel), 1.0)
            if speed_ratio < 1.1:
                # Not fast enough — chase intercept point with higher accel
                time_to_intercept = distance / (np.linalg.norm(self.velocity) * 0.8)
            else:
                time_to_intercept = distance / max(speed_ratio * np.linalg.norm(target_vel), 1.0)
            
            time_to_intercept = min(time_to_intercept, 2.5)  # Cap prediction horizon
            
            # Predict curved trajectory if target is turning (circular evasion detection)
            if target_accel is not None:
                # Target is accelerating — estimate turn rate
                accel_normal = target_accel - np.dot(target_accel, target_vel / max(np.linalg.norm(target_vel), 1.0)) * (target_vel / max(np.linalg.norm(target_vel), 1.0))
                turn_rate = np.linalg.norm(accel_normal) / max(np.linalg.norm(target_vel), 1.0)
                
                if turn_rate > 0.12:  # Circular evasion detected (lowered threshold)
                    # Predict curved path — aim for center of turn circle
                    angular_advance = turn_rate * time_to_intercept * 1.5  # Overshoot prediction
                    # Rotate velocity vector by predicted turn
                    cos_a = np.cos(angular_advance)
                    sin_a = np.sin(angular_advance)
                    # 2D rotation in XY plane (simplified — assumes horizontal turn)
                    vx, vy = target_vel[0], target_vel[1]
                    pred_vel = np.array([
                        vx * cos_a - vy * sin_a,
                        vx * sin_a + vy * cos_a,
                        target_vel[2],
                    ])
                    # Average velocity over turn
                    avg_vel = (target_vel + pred_vel) / 2.0
                    lead_point = target_pos + avg_vel * time_to_intercept
                else:
                    # Straight-line prediction
                    lead_point = target_pos + target_vel * time_to_intercept
            else:
                # No accel estimate — simple extrapolation
                lead_point = target_pos + target_vel * time_to_intercept
            
            to_lead = lead_point - self.position
            to_lead_norm = np.linalg.norm(to_lead)
            accel_cmd = (to_lead / to_lead_norm) * 10.0
            
            # If very close (<20m), switch to pure pursuit with max accel
            if distance < 20.0:
                to_target = (target_pos - self.position) / distance
                accel_cmd = to_target * 10.0
            
            rel_vel = target_vel - self.velocity
            closing_speed = -np.dot(rel_vel, (target_pos - self.position) / distance)
            pursuit_mode = "lead_pursuit"
            pursuit_info = {"closing_speed": closing_speed, "lead_time": time_to_intercept}

        return accel_cmd, {
            "state": "pursuing",
            "target": self.assigned_target,
            "distance": distance,
            "eti": eti,
            "closing_speed": pursuit_info.get("closing_speed", 0),
            "jink_detected": pursuit_info.get("jink_detected", False),
            "intercept_point": intercept_point.tolist(),
            "mode": pursuit_mode,
        }

    def _on_reassign(self, msg):
        """Handle reassignment from coordinator."""
        if msg.data.get("interceptor_id") == self.drone_id:
            new_target = msg.data.get("target_id")
            if new_target:
                self.assign_target(new_target)

    def _on_target_killed(self, msg):
        """Handle target killed by another drone."""
        if msg.data.get("target_id") == self.assigned_target:
            # Our target was killed by someone else
            self.go_idle()
            self.assigned_target = None


class InterceptCoordinator:
    """
    Ground station coordinator for intercept missions.
    
    Handles:
    - Target detection aggregation
    - Optimal assignment (Hungarian)
    - Reassignment on kill/loss
    - Status reporting
    """

    def __init__(self):
        self.bus = SwarmBus()
        self.interceptors = {}  # drone_id -> InterceptorDrone
        self.targets = {}  # target_id -> {"position", "velocity", "alive"}
        self.assignments = []  # list of (interceptor_id, target_id)
        self.lock = threading.Lock()

        # Coordinator needs its own DroneComms to receive messages
        self.comms = DroneComms("coordinator", self.bus)
        self.comms.listen("target_killed", self._on_kill)
        self.comms.listen("target_lost", self._on_lost)

    def add_interceptor(self, drone_id: str, vehicle=None):
        """Register an interceptor drone."""
        comms = DroneComms(drone_id, self.bus)
        drone = InterceptorDrone(drone_id, comms, vehicle)
        self.interceptors[drone_id] = drone
        return drone

    def update_targets(self, target_states: dict):
        """
        Update known target positions.
        
        Args:
            target_states: {target_id: {"position": [...], "velocity": [...]}}
        """
        with self.lock:
            for tid, state in target_states.items():
                if tid not in self.targets or self.targets[tid].get("alive", True):
                    self.targets[tid] = {**state, "alive": True}

    def execute_assignment(self):
        """
        Run Hungarian algorithm and assign/reassign interceptors.
        Also reassigns idle/intercepted drones to new targets.
        """
        with self.lock:
            # Build interceptor list (include idle/intercepted drones for reassignment)
            int_list = []
            for did, drone in self.interceptors.items():
                # Include all drones except those actively returning/lost
                if drone.state not in ["returning", "lost_target"]:
                    int_list.append({
                        "id": did,
                        "position": drone.position.tolist(),
                        "velocity": drone.velocity.tolist(),
                    })

            # Build live target list
            tgt_list = []
            for tid, state in self.targets.items():
                if state.get("alive", True):
                    tgt_list.append({
                        "id": tid,
                        "position": state["position"],
                        "velocity": state["velocity"],
                    })

        if not int_list or not tgt_list:
            return []

        # Optimal assignment
        assignments, unassigned_int, unassigned_tgt = assign_targets(int_list, tgt_list)

        # Apply assignments
        self.assignments = assignments
        for int_id, tgt_id in assignments:
            drone = self.interceptors.get(int_id)
            if drone:
                drone.assign_target(tgt_id)

                # Notify via bus
                self.bus.broadcast_all(SwarmMessage(
                    type="reassign",
                    sender="coordinator",
                    timestamp=time.time(),
                    data={"interceptor_id": int_id, "target_id": tgt_id},
                ))
        
        # Send idle/intercepted drones with no assignment back to idle
        for int_id in unassigned_int:
            drone = self.interceptors.get(int_id)
            if drone and drone.state in ["intercepted", "searching"]:
                drone.go_idle()
                drone.assigned_target = None

        return assignments

    def tick(self, interceptor_states: dict, target_states: dict, dt: float = 0.1):
        """
        Main coordinator update loop.
        
        Args:
            interceptor_states: {drone_id: {"position": [...], "velocity": [...]}}
            target_states: {target_id: {"position": [...], "velocity": [...]}}
            
        Returns:
            commands: {drone_id: accel_cmd}
            status: {drone_id: info}
        """
        self.update_targets(target_states)

        commands = {}
        status = {}

        for did, drone in self.interceptors.items():
            own_state = interceptor_states.get(did, {
                "position": [0, 0, 0], "velocity": [0, 0, 0],
            })
            accel, info = drone.tick(own_state, target_states, dt)
            commands[did] = accel
            status[did] = info

        return commands, status

    def get_status(self):
        """Get mission status summary."""
        alive_targets = sum(1 for t in self.targets.values() if t.get("alive", True))
        total_targets = len(self.targets)
        
        drone_status = {}
        for did, drone in self.interceptors.items():
            drone_status[did] = {
                "state": drone.state,
                "target": drone.assigned_target,
                "position": drone.position.tolist(),
            }

        return {
            "targets_alive": alive_targets,
            "targets_total": total_targets,
            "targets_killed": total_targets - alive_targets,
            "interceptors": drone_status,
            "assignments": [(a, b) for a, b in self.assignments],
        }

    def _on_kill(self, msg):
        """Handle target kill report."""
        target_id = msg.data.get("target_id")
        with self.lock:
            if target_id in self.targets:
                self.targets[target_id]["alive"] = False

        # Re-run assignment for free interceptors
        self.execute_assignment()

    def _on_lost(self, msg):
        """Handle target lost report."""
        # Re-run assignment
        self.execute_assignment()


# Convenience import
from .swarm_comms import SwarmMessage
