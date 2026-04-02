"""
Follow Controller — Visual Servoing

Keeps a tracked object centered in the drone's camera frame
by steering the drone. Runs as a continuous loop.

"Follow that car" → YOLO detects car → tracker maintains ID →
follow controller steers drone to keep car centered.
"""

import math
import time
import threading


class FollowController:
    """
    Visual servoing controller for one drone following one target.
    
    Uses pixel error (target offset from frame center) to generate
    movement commands. PID-style control for smooth tracking.
    """

    def __init__(self, drone_id, frame_width=640, frame_height=480, camera_fov=1.2):
        self.drone_id = drone_id
        self.frame_w = frame_width
        self.frame_h = frame_height
        self.camera_fov = camera_fov  # radians

        # Target
        self.target_id = None       # Tracked object ID (e.g. "car_3")
        self.target_class = None    # Class to follow if no specific ID
        self.active = False

        # PID gains for pixel-to-velocity conversion
        self.kp_lateral = 0.005     # Proportional gain (lateral)
        self.kp_forward = 0.003    # Proportional gain (forward/back based on size)
        self.ki_lateral = 0.0001   # Integral gain
        self.kd_lateral = 0.002    # Derivative gain

        # State
        self.error_integral = [0, 0]
        self.last_error = [0, 0]
        self.target_bbox_height = 80  # Desired target size in pixels (controls distance)
        self.follow_altitude = 10     # Maintain this altitude while following

        # Status
        self.last_command = None
        self.frames_without_target = 0
        self.max_lost_frames = 30    # Give up after 3 seconds at 10Hz

    def start(self, target_id=None, target_class=None, altitude=10, distance_px=80):
        """Start following a target."""
        self.target_id = target_id
        self.target_class = target_class
        self.follow_altitude = altitude
        self.target_bbox_height = distance_px
        self.active = True
        self.error_integral = [0, 0]
        self.last_error = [0, 0]
        self.frames_without_target = 0
        print(f"[Follow] {self.drone_id} following {target_id or target_class}")

    def stop(self):
        """Stop following."""
        self.active = False
        self.target_id = None
        self.target_class = None
        self.last_command = None
        print(f"[Follow] {self.drone_id} stopped following")

    def compute(self, tracked_objects):
        """
        Compute movement command based on tracked objects.
        
        Args:
            tracked_objects: list of TrackedObject from tracker
            
        Returns:
            command: {"dx": float, "dy": float, "dz": float} or None
            info: dict with status
        """
        if not self.active:
            return None, {"status": "inactive"}

        # Find our target
        target = None
        if self.target_id:
            target = next((t for t in tracked_objects if t.id == self.target_id), None)
        elif self.target_class:
            # Find closest of that class to center
            candidates = [t for t in tracked_objects if t.cls == self.target_class and t.misses == 0]
            if candidates:
                cx, cy = self.frame_w / 2, self.frame_h / 2
                target = min(candidates, key=lambda t:
                    math.sqrt((t.center[0]-cx)**2 + (t.center[1]-cy)**2))
                # Lock onto this specific target
                self.target_id = target.id

        if target is None or target.misses > 0:
            self.frames_without_target += 1
            if self.frames_without_target > self.max_lost_frames:
                self.stop()
                return None, {"status": "target_lost", "frames_without": self.frames_without_target}
            return None, {"status": "searching", "frames_without": self.frames_without_target}

        self.frames_without_target = 0

        # ─── Pixel Error ─────────────────────────────────────────
        # Error = target center - frame center
        cx = self.frame_w / 2
        cy = self.frame_h / 2
        ex = target.center[0] - cx  # Positive = target is right
        ey = target.center[1] - cy  # Positive = target is below

        # Size error (controls following distance)
        target_height = target.bbox[3] - target.bbox[1]
        size_error = self.target_bbox_height - target_height  # Positive = too far

        # ─── PID Control ─────────────────────────────────────────
        # Lateral (left/right based on horizontal pixel error)
        self.error_integral[0] += ex * 0.1  # dt = 0.1 at 10Hz
        self.error_integral[0] = max(-100, min(100, self.error_integral[0]))  # Anti-windup
        d_ex = ex - self.last_error[0]

        lateral = (
            self.kp_lateral * ex +
            self.ki_lateral * self.error_integral[0] +
            self.kd_lateral * d_ex
        )

        # Forward/back (based on target size in frame)
        forward = self.kp_forward * size_error

        # Vertical (keep altitude constant — minor correction from vertical pixel error)
        vertical = -0.001 * ey  # Subtle altitude adjustment

        self.last_error = [ex, ey]

        # ─── Convert to World Movement ───────────────────────────
        # Lateral pixel error → east/west movement
        # Forward size error → north/south movement
        # This is approximate — proper version would use camera orientation
        command = {
            "dx": round(forward, 3),     # Forward/back (north)
            "dy": round(lateral, 3),     # Left/right (east)
            "dz": round(vertical, 3),    # Up/down
        }

        self.last_command = command

        return command, {
            "status": "tracking",
            "target_id": target.id,
            "target_class": target.cls,
            "pixel_error": [round(ex, 1), round(ey, 1)],
            "size_error": round(size_error, 1),
            "distance_estimate": "close" if target_height > 120 else "far" if target_height < 40 else "good",
            "command": command,
        }

    def to_dict(self):
        return {
            "active": self.active,
            "drone_id": self.drone_id,
            "target_id": self.target_id,
            "target_class": self.target_class,
            "frames_without_target": self.frames_without_target,
            "last_command": self.last_command,
        }


class FollowManager:
    """
    Manages follow controllers for all drones.
    
    Runs the detect → track → steer loop.
    """

    def __init__(self):
        self.controllers = {}  # drone_id -> FollowController

    def add_drone(self, drone_id, frame_w=640, frame_h=480):
        self.controllers[drone_id] = FollowController(drone_id, frame_w, frame_h)

    def start_follow(self, drone_id, target_id=None, target_class=None, altitude=10):
        """Start a drone following a target."""
        ctrl = self.controllers.get(drone_id)
        if ctrl:
            ctrl.start(target_id=target_id, target_class=target_class, altitude=altitude)
            return True
        return False

    def stop_follow(self, drone_id):
        ctrl = self.controllers.get(drone_id)
        if ctrl:
            ctrl.stop()

    def stop_all(self):
        for ctrl in self.controllers.values():
            ctrl.stop()

    def tick(self, drone_trackers):
        """
        Run one follow tick for all active controllers.
        
        Args:
            drone_trackers: {drone_id: [TrackedObject, ...]}
            
        Returns:
            commands: {drone_id: {"dx", "dy", "dz"}}
            status: {drone_id: info}
        """
        commands = {}
        status = {}

        for drone_id, ctrl in self.controllers.items():
            if not ctrl.active:
                continue

            tracked = drone_trackers.get(drone_id, [])
            cmd, info = ctrl.compute(tracked)
            if cmd:
                commands[drone_id] = cmd
            status[drone_id] = info

        return commands, status

    def get_status(self):
        return {did: c.to_dict() for did, c in self.controllers.items() if c.active}
