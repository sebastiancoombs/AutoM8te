#!/usr/bin/env python3
"""
Minimal camera streamer for AutoM8te drones.
Streams camera frames over TCP for YOLO server.
Each drone streams on port 5600 + instance_id.
"""

import os
import sys
import socket
import struct
import numpy as np

WEBOTS_HOME = os.environ.get("WEBOTS_HOME", "/Applications/Webots.app")
sys.path.append(f"{WEBOTS_HOME}/lib/controller/python")

from controller import Robot


def get_instance(robot):
    try:
        return int(robot.getName().split('_')[-1])
    except (ValueError, IndexError):
        return 0


def main():
    robot = Robot()
    instance = get_instance(robot)
    timestep = int(robot.getBasicTimeStep())

    camera = robot.getDevice("camera")
    if camera is None:
        print(f"[Camera] {robot.getName()} has no camera!")
        while robot.step(timestep) != -1:
            pass
        return

    camera.enable(timestep)
    port = 5600 + instance
    width = camera.getWidth()
    height = camera.getHeight()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('0.0.0.0', port))
    server.listen(1)
    server.settimeout(0.1)

    print(f"[Camera] {robot.getName()} streaming {width}x{height} on :{port}")

    client = None
    while robot.step(timestep) != -1:
        image = camera.getImage()
        if image is None:
            continue

        if client is None:
            try:
                client, addr = server.accept()
                client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                print(f"[Camera] {robot.getName()} client from {addr}")
            except socket.timeout:
                continue

        try:
            img = np.frombuffer(image, dtype=np.uint8).reshape(height, width, 4)
            rgb = img[:, :, [2, 1, 0]].tobytes()
            client.sendall(struct.pack('>I', len(rgb)) + rgb)
        except (BrokenPipeError, ConnectionResetError):
            client = None


if __name__ == "__main__":
    main()
