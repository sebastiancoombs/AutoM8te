#!/usr/bin/env python3
"""
Add N Iris drones to the autom8te_city.wbt world file.

Usage:
  python3 add_drones.py [--count 4] [--spacing 5] [--center-x 50] [--center-z -50]

This inserts Iris drone nodes directly into the .wbt file so their
controllers load at world start (avoiding the dynamic spawn Python issue).
"""

import argparse
import math
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORLD_FILE = os.path.join(SCRIPT_DIR, "../../worlds/autom8te_city.wbt")

DRONE_MARKER_START = "# === AUTOM8TE DRONES START ==="
DRONE_MARKER_END = "# === AUTOM8TE DRONES END ==="

DRONE_TEMPLATE = """DEF DRONE_{id} Iris {{
  translation {x} {y} {z}
  name "drone_{id}"
  controller "ardupilot_vehicle_controller"
  controllerArgs [
    "--motors"
    "m1_motor, m2_motor, m3_motor, m4_motor"
    "--instance"
    "{id}"
    "--camera"
    "camera"
    "--camera-port"
    "{camera_port}"
  ]
  extensionSlot [
    Camera {{
      name "camera"
      translation 0.2 0 0.01
      rotation 0 0 1 0
      width 640
      height 480
      fieldOfView 1.2
      near 0.1
    }}
  ]
}}"""


def compute_positions(count, spacing, center_x, center_y, altitude=0.4):
    positions = []
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)
    offset_x = (cols - 1) * spacing / 2
    offset_y = (rows - 1) * spacing / 2

    for i in range(count):
        col = i % cols
        row = i // cols
        x = center_x + col * spacing - offset_x
        y = center_y + row * spacing - offset_y
        z = altitude  # Z = up in ENU (R2025a default)
        positions.append((x, y, z))
    return positions


def main():
    parser = argparse.ArgumentParser(description="Add drones to world file")
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--spacing", type=float, default=5.0)
    parser.add_argument("--center-x", type=float, default=-45.0)
    parser.add_argument("--center-y", type=float, default=45.0)
    parser.add_argument("--altitude", type=float, default=0.4)
    parser.add_argument("--camera-port-base", type=int, default=5600)
    parser.add_argument("--world", type=str, default=WORLD_FILE)
    args = parser.parse_args()

    world_path = os.path.abspath(args.world)
    with open(world_path, "r") as f:
        content = f.read()

    # Remove existing drone section if present
    if DRONE_MARKER_START in content:
        start = content.index(DRONE_MARKER_START)
        end = content.index(DRONE_MARKER_END) + len(DRONE_MARKER_END)
        content = content[:start].rstrip() + "\n" + content[end:].lstrip()

    # Also remove the spawner Robot node if present
    spawner_start = content.find('Robot {\n  name "spawner"')
    if spawner_start == -1:
        spawner_start = content.find("Robot {\n  name \"spawner\"")
    if spawner_start != -1:
        # Find the matching closing brace
        depth = 0
        i = spawner_start
        while i < len(content):
            if content[i] == '{':
                depth += 1
            elif content[i] == '}':
                depth -= 1
                if depth == 0:
                    content = content[:spawner_start].rstrip() + "\n" + content[i+1:].lstrip()
                    break
            i += 1

    # Generate drone nodes
    positions = compute_positions(
        args.count, args.spacing,
        args.center_x, args.center_y, args.altitude
    )

    drones_section = f"\n{DRONE_MARKER_START}\n"
    for i, (x, y, z) in enumerate(positions):
        camera_port = args.camera_port_base + i
        drones_section += DRONE_TEMPLATE.format(
            id=i, x=x, y=y, z=z, camera_port=camera_port
        )
        drones_section += "\n"
    drones_section += f"{DRONE_MARKER_END}\n"

    # Append to end of file
    content = content.rstrip() + "\n" + drones_section

    with open(world_path, "w") as f:
        f.write(content)

    print(f"Added {args.count} Iris drones to {world_path}")
    for i, (x, y, z) in enumerate(positions):
        print(f"  drone_{i}: ({x:.1f}, {y:.1f}, {z:.1f}) cam:{args.camera_port_base + i}")
    print(f"\nStart SITL:")
    for i in range(args.count):
        print(f"  sim_vehicle.py -v ArduCopter --model webots-python -I{i}")


if __name__ == "__main__":
    main()
