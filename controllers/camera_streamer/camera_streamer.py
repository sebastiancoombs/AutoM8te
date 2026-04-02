#!/usr/bin/env python3
"""
Drone flight controller + camera streamer for AutoM8te.

Each drone runs this controller to:
1. Read target commands from customData (set by Supervisor)
2. Run PID flight controller → real motor thrust → physics-based flight
3. Stream camera over TCP for YOLO server
4. Write GPS position back to customData for Supervisor to read

Communication protocol (customData JSON):
  Supervisor writes: {"target": [x,y,z], "cmd": "takeoff|land|hover|goto", "armed": true}
  Drone writes back: {"pos": [x,y,z], "mode": "HOVER", "armed": true, ...}
"""

import os
import sys
import json
import math
import socket
import struct
import numpy as np

WEBOTS_HOME = os.environ.get("WEBOTS_HOME", "/Applications/Webots.app")
sys.path.append(f"{WEBOTS_HOME}/lib/controller/python")

from controller import Robot


# ─── PID Controller ──────────────────────────────────────────────────

class PID:
    def __init__(self, kp, ki, kd, limit=None):
        self.kp, self.ki, self.kd = kp, ki, kd
        self.limit = limit
        self.integral = 0.0
        self.prev_error = 0.0

    def update(self, error, dt):
        self.integral += error * dt
        if self.limit:
            self.integral = max(-self.limit, min(self.limit, self.integral))
        derivative = (error - self.prev_error) / max(dt, 1e-6)
        self.prev_error = error
        output = self.kp * error + self.ki * self.integral + self.kd * derivative
        if self.limit:
            output = max(-self.limit, min(self.limit, output))
        return output

    def reset(self):
        self.integral = 0.0
        self.prev_error = 0.0


# ─── Flight Controller ──────────────────────────────────────────────

class FlightController:
    """PID-based quadcopter controller using Webots Propeller physics.
    
    The Propeller node in Webots generates thrust = thrustConstants[0] * omega^2.
    With thrustConstants = 0.0012, mass = 1.5kg:
      hover_omega = sqrt(m*g / (4*k)) = sqrt(1.5*9.81 / (4*0.0012)) ≈ 55.4 rad/s
    """

    # Motor mixing for X-quad: [throttle, roll, pitch, yaw]
    MIXER = [
        [1.0, -1.0, +1.0, +1.0],   # m1 (front-right, CCW)
        [1.0, +1.0, -1.0, +1.0],   # m2 (back-left, CCW)
        [1.0, +1.0, +1.0, -1.0],   # m3 (front-left, CW)
        [1.0, -1.0, -1.0, -1.0],   # m4 (back-right, CW)
    ]

    def __init__(self, robot):
        self.robot = robot
        self.timestep = int(robot.getBasicTimeStep())

        # ─── Sensors ───
        self.gps = robot.getDevice("gps")
        self.gyro = robot.getDevice("gyro")
        self.imu = robot.getDevice("inertial unit")
        self.gps.enable(self.timestep)
        self.gyro.enable(self.timestep)
        self.imu.enable(self.timestep)

        # ─── Motors ───
        self.motors = []
        for name in ["m1_motor", "m2_motor", "m3_motor", "m4_motor"]:
            m = robot.getDevice(name)
            m.setPosition(float('inf'))  # Continuous rotation mode
            m.setVelocity(0.0)
            self.motors.append(m)

        # Hover velocity from physics
        self.hover_vel = math.sqrt(1.5 * 9.81 / (4 * 0.0012))  # ≈ 55.4 rad/s

        # ─── PIDs ───
        # Altitude → throttle adjustment (rad/s offset from hover)
        self.alt_pid = PID(kp=2.5, ki=0.8, kd=1.8, limit=25.0)
        # Position error → desired tilt angle (radians)
        self.x_pid = PID(kp=0.5, ki=0.05, kd=0.4, limit=0.25)
        self.y_pid = PID(kp=0.5, ki=0.05, kd=0.4, limit=0.25)
        # Attitude error → motor speed adjustment
        self.roll_pid = PID(kp=25.0, ki=1.0, kd=8.0, limit=15.0)
        self.pitch_pid = PID(kp=25.0, ki=1.0, kd=8.0, limit=15.0)
        self.yaw_pid = PID(kp=4.0, ki=0.2, kd=1.5, limit=8.0)

        # State
        self.target = None
        self.cmd = "idle"
        self.armed = False

    def read_command(self):
        """Read target from customData (written by Supervisor)."""
        raw = self.robot.getCustomData()
        if not raw:
            return
        try:
            data = json.loads(raw)
            if "target" in data and data["target"] is not None:
                self.target = data["target"]
            if "cmd" in data:
                self.cmd = data["cmd"]
            if "armed" in data:
                self.armed = data["armed"]
        except (json.JSONDecodeError, TypeError):
            pass

    def update(self, dt):
        """Main flight control loop."""
        self.read_command()

        # Not armed → motors off
        if not self.armed or self.cmd == "idle":
            for m in self.motors:
                m.setVelocity(0.0)
            return

        if self.target is None:
            return

        # Read sensors
        pos = self.gps.getValues()       # [x, y, z]
        rpy = self.imu.getValues()       # [roll, pitch, yaw]

        # NaN guard (sensors warming up)
        if any(math.isnan(v) for v in pos) or any(math.isnan(v) for v in rpy):
            return

        # ─── Landing ───
        if self.cmd == "land":
            target_alt = 0.15
            if pos[2] < 0.25:
                for m in self.motors:
                    m.setVelocity(0.0)
                self.cmd = "idle"
                self.armed = False
                return
        else:
            target_alt = self.target[2]

        # ─── Altitude PID → throttle offset ───
        alt_error = target_alt - pos[2]
        throttle_adj = self.alt_pid.update(alt_error, dt)

        # ─── Horizontal position → desired tilt angles ───
        x_error = self.target[0] - pos[0]
        y_error = self.target[1] - pos[1]

        # Rotate world-frame error into body frame
        yaw = rpy[2]
        cos_y, sin_y = math.cos(yaw), math.sin(yaw)
        fwd_err = x_error * cos_y + y_error * sin_y
        lat_err = -x_error * sin_y + y_error * cos_y

        desired_pitch = -self.x_pid.update(fwd_err, dt)
        desired_roll = self.y_pid.update(lat_err, dt)

        # ─── Attitude PID → motor corrections ───
        roll_cmd = self.roll_pid.update(desired_roll - rpy[0], dt)
        pitch_cmd = self.pitch_pid.update(desired_pitch - rpy[1], dt)
        yaw_cmd = self.yaw_pid.update(-rpy[2], dt)  # Hold heading north

        # ─── Motor mixing ───
        base = self.hover_vel + throttle_adj

        for i, motor in enumerate(self.motors):
            mix = self.MIXER[i]
            vel = (base * mix[0] +
                   roll_cmd * mix[1] +
                   pitch_cmd * mix[2] +
                   yaw_cmd * mix[3])
            vel = max(0.0, min(100.0, vel))
            motor.setVelocity(vel)

    def write_state(self):
        """Write position + state back to customData for Supervisor to read."""
        try:
            pos = self.gps.getValues()
            if any(math.isnan(v) for v in pos):
                return
            raw = self.robot.getCustomData()
            data = {}
            if raw:
                try:
                    data = json.loads(raw)
                except:
                    pass
            data["pos"] = [round(v, 3) for v in pos]
            data["mode"] = self.cmd
            data["armed"] = self.armed
            self.robot.setCustomData(json.dumps(data))
        except:
            pass


# ─── Camera Streaming ────────────────────────────────────────────────

def get_instance(robot):
    try:
        return int(robot.getName().split('_')[-1])
    except (ValueError, IndexError):
        return 0


def main():
    robot = Robot()
    instance = get_instance(robot)
    timestep = int(robot.getBasicTimeStep())
    dt = timestep / 1000.0

    # Flight controller
    fc = FlightController(robot)
    print(f"[Drone] {robot.getName()} FC ready (hover={fc.hover_vel:.1f} rad/s)")

    # Camera
    camera = robot.getDevice("camera")
    server = None
    client = None
    port = 5600 + instance

    if camera:
        camera.enable(timestep)
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(('0.0.0.0', port))
        server.listen(1)
        server.settimeout(0.001)
        width = camera.getWidth()
        height = camera.getHeight()
        print(f"[Drone] {robot.getName()} camera {width}x{height} on :{port}")

    frame_count = 0
    while robot.step(timestep) != -1:
        # Flight control every tick
        fc.update(dt)
        fc.write_state()

        # Camera stream (every 4th tick)
        if camera and frame_count % 4 == 0:
            image = camera.getImage()
            if image:
                if client is None and server:
                    try:
                        client, addr = server.accept()
                        client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                    except socket.timeout:
                        pass
                if client:
                    try:
                        img = np.frombuffer(image, dtype=np.uint8).reshape(height, width, 4)
                        rgb = img[:, :, [2, 1, 0]].tobytes()
                        client.sendall(struct.pack('>I', len(rgb)) + rgb)
                    except (BrokenPipeError, ConnectionResetError):
                        client = None

        frame_count += 1


if __name__ == "__main__":
    main()
