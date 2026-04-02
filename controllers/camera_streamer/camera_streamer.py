#!/usr/bin/env python3
"""
Minimal camera controller for AutoM8te drones.

Does ONE thing: enables the camera and streams frames over TCP.
The Supervisor handles all movement — this just provides eyes.

Each drone streams on port 5600 + instance_id.
YOLO server connects to these ports.
"""

import os
import sys
import socket
import struct
import threading
import argparse
import numpy as np

WEBOTS_HOME = os.environ.get("WEBOTS_HOME", "/Applications/Webots.app")
sys.path.append(f"{WEBOTS_HOME}/lib/controller/python")

from controller import Robot


def get_instance_from_name(robot):
    """Extract instance number from robot name (e.g. 'drone_2' → 2)."""
    name = robot.getName()
    try:
        return int(name.split('_')[-1])
    except (ValueError, IndexError):
        return 0


def stream_camera(robot, camera, port):
    """Stream camera frames over TCP to YOLO server."""
    timestep = int(robot.getBasicTimeStep())
    width = camera.getWidth()
    height = camera.getHeight()

    # Create TCP server
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('0.0.0.0', port))
    server.listen(1)
    server.settimeout(0.1)

    print(f"[Camera] {robot.getName()} streaming {width}x{height} on port {port}")

    client = None

    while robot.step(timestep) != -1:
        image = camera.getImage()
        if image is None:
            continue

        # Convert BGRA to RGB bytes
        img = np.frombuffer(image, dtype=np.uint8).reshape(height, width, 4)
        rgb = img[:, :, [2, 1, 0]].tobytes()  # BGRA → RGB

        # Accept new connection
        if client is None:
            try:
                client, addr = server.accept()
                client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                print(f"[Camera] {robot.getName()} client connected from {addr}")
            except socket.timeout:
                continue

        # Send frame: [4 bytes length][rgb data]
        try:
            frame_data = struct.pack('>I', len(rgb)) + rgb
            client.sendall(frame_data)
        except (BrokenPipeError, ConnectionResetError):
            print(f"[Camera] {robot.getName()} client disconnected")
            client = None


MOTOR_NAMES = ["m1_motor", "m2_motor", "m3_motor", "m4_motor"]
MOTOR_SPIN_VELOCITY = 80.0  # rad/s visual spin


def setup_motors(robot):
    """Set up propeller motors for continuous visual spin."""
    motors = []
    for i, name in enumerate(MOTOR_NAMES):
        try:
            motor = robot.getDevice(name)
            if motor:
                motor.setPosition(float('inf'))  # Continuous rotation mode
                vel = MOTOR_SPIN_VELOCITY if i % 2 == 0 else -MOTOR_SPIN_VELOCITY
                motor.setVelocity(vel)
                motors.append(motor)
            else:
                print(f"[Camera] {robot.getName()} motor '{name}' not found")
        except Exception as e:
            print(f"[Camera] {robot.getName()} motor '{name}' error: {e}")
    return motors


def main():
    robot = Robot()
    instance = get_instance_from_name(robot)

    # Spin propellers immediately
    motors = setup_motors(robot)
    if motors:
        print(f"[Camera] {robot.getName()} spinning {len(motors)} propellers")

    # Enable camera
    camera = robot.getDevice("camera")
    if camera is None:
        print(f"[Camera] {robot.getName()} has no camera device!")
        while robot.step(int(robot.getBasicTimeStep())) != -1:
            pass
        return

    fps = 10
    camera.enable(1000 // fps)

    port = 5600 + instance
    print(f"[Camera] {robot.getName()} (instance {instance}) camera enabled at {fps}fps")

    stream_camera(robot, camera, port)


if __name__ == "__main__":
    main()
