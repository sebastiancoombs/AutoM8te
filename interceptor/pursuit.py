"""
Smart Pursuit — Augmented Proportional Navigation (APN)

Standard PN steers toward where the target IS.
APN steers toward where the target WILL BE, accounting for:
- Target velocity (lead pursuit)
- Target acceleration (maneuver compensation)
- Closing velocity changes
- Evasive jinking patterns

This is what real missile guidance uses against maneuvering targets.
"""

import numpy as np
from collections import deque
from filterpy.kalman import KalmanFilter as KF


class PursuitController:
    """
    Augmented Proportional Navigation guidance for intercepting
    an evasive target drone.
    """

    def __init__(self, nav_gain=4.0, max_accel=8.0, history_size=20):
        """
        Args:
            nav_gain: Navigation constant N (typically 3-5, higher = more aggressive)
                      4.0 is optimal against maneuvering targets
            max_accel: Max acceleration command (m/s²)
            history_size: Number of target states to track for prediction
        """
        self.N = nav_gain
        self.max_accel = max_accel

        # Target history for acceleration estimation
        self.target_history = deque(maxlen=history_size)
        self.last_los_rate = None
        self.last_time = None

        # Evasion pattern detection
        self.accel_history = deque(maxlen=30)
        self.jink_detected = False
        self.jink_period = None

    def update(self, pursuer_pos, pursuer_vel, target_pos, target_vel, dt=0.1):
        """
        Compute acceleration command to intercept target.

        Args:
            pursuer_pos: np.array [x, y, z]
            pursuer_vel: np.array [vx, vy, vz]
            target_pos: np.array [x, y, z]
            target_vel: np.array [vx, vy, vz]
            dt: time step

        Returns:
            accel_cmd: np.array [ax, ay, az] — acceleration to apply
            info: dict with debug info
        """
        pursuer_pos = np.array(pursuer_pos, dtype=float)
        pursuer_vel = np.array(pursuer_vel, dtype=float)
        target_pos = np.array(target_pos, dtype=float)
        target_vel = np.array(target_vel, dtype=float)

        # --- Line of Sight (LOS) geometry ---
        los = target_pos - pursuer_pos  # LOS vector
        distance = np.linalg.norm(los)

        if distance < 0.5:
            # Close enough — intercept achieved
            return np.zeros(3), {"status": "intercept", "distance": distance}

        los_unit = los / distance

        # --- Relative velocity ---
        rel_vel = target_vel - pursuer_vel
        closing_speed = -np.dot(rel_vel, los_unit)  # Positive = closing

        if closing_speed < 0.1:
            # Not closing — fly directly at target (pure pursuit fallback)
            accel = los_unit * self.max_accel
            return self._clamp(accel), {
                "status": "pure_pursuit",
                "distance": distance,
                "closing_speed": closing_speed,
            }

        # --- LOS rate (rotation rate of line-of-sight) ---
        # LOS rate = (V_rel × LOS_unit) / distance
        los_rate = np.cross(los_unit, rel_vel) / distance
        # This gives the angular velocity vector of the LOS

        # --- Estimate target acceleration ---
        target_accel = self._estimate_target_accel(target_pos, target_vel, dt)

        # --- Augmented Proportional Navigation ---
        # Standard PN:  a_cmd = N * Vc * LOS_rate
        # Augmented PN: a_cmd = N * Vc * LOS_rate + (N/2) * target_accel_normal
        #
        # The augmented term compensates for target maneuvers

        # PN component (perpendicular to LOS)
        pn_accel = self.N * closing_speed * np.cross(los_unit, los_rate)

        # Augmented component (target acceleration normal to LOS)
        if target_accel is not None:
            accel_along_los = np.dot(target_accel, los_unit) * los_unit
            accel_normal = target_accel - accel_along_los
            aug_accel = (self.N / 2.0) * accel_normal
        else:
            aug_accel = np.zeros(3)

        # --- Jink compensation ---
        jink_accel = self._compensate_jink(target_accel, los_unit)

        # --- Combined command ---
        accel_cmd = pn_accel + aug_accel + jink_accel

        # Add bias toward target (ensures closing even in edge cases)
        # Stronger bias when closing speed is low
        bias_strength = 2.0 if closing_speed < 5.0 else 1.0
        bias = los_unit * bias_strength
        accel_cmd += bias

        # Time to intercept estimate
        eti = distance / max(closing_speed, 0.5)

        return self._clamp(accel_cmd), {
            "status": "pursuing",
            "distance": distance,
            "closing_speed": closing_speed,
            "eti": eti,
            "jink_detected": self.jink_detected,
            "target_accel": np.linalg.norm(target_accel) if target_accel is not None else 0,
        }

    def _estimate_target_accel(self, pos, vel, dt):
        """
        Estimate target acceleration from velocity history.
        Uses finite differences with smoothing.
        """
        self.target_history.append({"pos": pos.copy(), "vel": vel.copy()})

        if len(self.target_history) < 3:
            return None

        # Use last 3 velocity samples for acceleration estimate
        v0 = self.target_history[-3]["vel"]
        v1 = self.target_history[-2]["vel"]
        v2 = self.target_history[-1]["vel"]

        # Central difference (smoother than forward difference)
        accel = (v2 - v0) / (2 * dt)

        # Track acceleration history for jink detection
        self.accel_history.append(accel.copy())

        return accel

    def _compensate_jink(self, target_accel, los_unit):
        """
        Detect and compensate for evasive jinking patterns.
        
        Jinking = periodic lateral acceleration changes.
        If detected, we predict the NEXT jink direction and pre-compensate.
        """
        if target_accel is None or len(self.accel_history) < 10:
            self.jink_detected = False
            return np.zeros(3)

        # Check for oscillating acceleration (sign changes in lateral accel)
        recent = list(self.accel_history)[-10:]
        lateral_accels = []
        for a in recent:
            # Project acceleration perpendicular to LOS
            a_along = np.dot(a, los_unit) * los_unit
            a_lateral = a - a_along
            lateral_accels.append(np.linalg.norm(a_lateral))

        # Jinking = high lateral acceleration with sign changes
        avg_lateral = np.mean(lateral_accels)
        if avg_lateral > 2.0:  # Significant lateral maneuvering
            self.jink_detected = True

            # Predict next jink: assume target will reverse current lateral accel
            # So we pre-steer in the OPPOSITE direction of current compensation
            # This makes the interceptor "lead" the jink
            current_lateral = target_accel - np.dot(target_accel, los_unit) * los_unit
            
            # Dampen the compensation (don't fully commit to prediction)
            return -0.3 * current_lateral
        else:
            self.jink_detected = False
            return np.zeros(3)

    def _clamp(self, accel):
        """Clamp acceleration to max_accel magnitude."""
        mag = np.linalg.norm(accel)
        if mag > self.max_accel:
            return accel * (self.max_accel / mag)
        return accel

    def reset(self):
        """Reset state for new target assignment."""
        self.target_history.clear()
        self.accel_history.clear()
        self.last_los_rate = None
        self.jink_detected = False


class PredictiveIntercept:
    """
    Higher-level intercept planner that predicts target trajectory
    using a Kalman filter and flies to the predicted intercept point.

    State: [x, y, z, vx, vy, vz], Measurement: [x, y, z]
    """

    def __init__(self, max_speed=15.0, prediction_iterations=3, dt=0.1):
        self.max_speed = max_speed
        self.iterations = prediction_iterations

        # Kalman filter: 6 state (pos + vel), 3 measurement (pos)
        self.kf = KF(dim_x=6, dim_z=3)

        # State transition: constant velocity model
        self.kf.F = np.eye(6)
        for i in range(3):
            self.kf.F[i, i + 3] = dt

        # Measurement matrix: we observe position only
        self.kf.H = np.zeros((3, 6))
        self.kf.H[0, 0] = 1.0
        self.kf.H[1, 1] = 1.0
        self.kf.H[2, 2] = 1.0

        # Covariances
        self.kf.P *= 100.0  # Initial uncertainty
        self.kf.R *= 2.0    # Measurement noise
        # Process noise — higher for velocity states (maneuvers)
        q_pos = 0.1
        q_vel = 5.0
        self.kf.Q = np.diag([q_pos, q_pos, q_pos, q_vel, q_vel, q_vel])

        self._initialized = False

    def compute_intercept_point(self, pursuer_pos, target_pos, target_vel, target_accel=None):
        """
        Compute the optimal intercept point using Kalman-filtered
        target state prediction.

        Returns:
            intercept_point: np.array [x, y, z]
            time_to_intercept: float (seconds)
        """
        pursuer_pos = np.array(pursuer_pos, dtype=float)
        target_pos = np.array(target_pos, dtype=float)
        target_vel = np.array(target_vel, dtype=float)

        # Initialize KF on first call
        if not self._initialized:
            self.kf.x = np.array([[target_pos[0]], [target_pos[1]], [target_pos[2]],
                                  [target_vel[0]], [target_vel[1]], [target_vel[2]]])
            self._initialized = True

        # Predict + update
        self.kf.predict()
        self.kf.update(target_pos.reshape(3, 1))

        # Extract filtered state (flatten from (n,1) to (n,))
        filtered_pos = self.kf.x[:3].flatten()
        filtered_vel = self.kf.x[3:].flatten()

        # Iterative intercept point refinement using filtered state
        t = np.linalg.norm(filtered_pos - pursuer_pos) / self.max_speed

        for _ in range(self.iterations):
            predicted_pos = filtered_pos + filtered_vel * t
            dist = np.linalg.norm(predicted_pos - pursuer_pos)
            t = dist / self.max_speed

        return predicted_pos, t
