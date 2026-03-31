"""
AutoM8te Drone Spawner — Webots Supervisor Controller

Spawns N ArduPilot Iris drones into any Webots world at runtime.
Each drone gets a forward-facing camera and connects to its own SITL instance.

Usage in .wbt file:
    Robot {
        name "spawner"
        controller "drone_spawner"
        controllerArgs ["--count", "4", "--spacing", "5", "--altitude", "0.5"]
        supervisor TRUE
    }

Requires in the .wbt EXTERNPROTO section:
    EXTERNPROTO "../protos/Iris.proto"

Each drone uses ArduPilot's official Iris PROTO with:
  - ardupilot_vehicle_controller (handles SITL communication)
  - Forward-facing camera in the extension slot
  - Unique SITL instance port per drone
"""

import argparse
import sys
import math

try:
    from controller import Supervisor
except ImportError:
    print("ERROR: Must be run as a Webots controller", file=sys.stderr)
    sys.exit(1)

TIME_STEP = 32

# --- Iris PROTO spawn template ---
# Uses ArduPilot's official Iris.proto with camera in extensionSlot
DRONE_TEMPLATE = """
DEF DRONE_{id} Iris {{
  translation {x} {y} {z}
  name "drone_{id}"
  controller "ardupilot_vehicle_controller"
  controllerArgs [
    "--motors"
    "m1_motor, m2_motor, m3_motor, m4_motor"
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
}}
"""


def compute_spawn_positions(count, spacing, center_x=0, center_z=0, altitude=0.5):
    """Compute grid spawn positions for N drones.
    
    Webots NUE coordinate system:
      X = North, Y = Up, Z = East
    Grid spreads on X and Z (ground plane), Y = altitude.
    """
    positions = []
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)

    # Center the grid on the ground plane (X, Z)
    offset_x = (cols - 1) * spacing / 2
    offset_z = (rows - 1) * spacing / 2

    for i in range(count):
        col = i % cols
        row = i // cols
        x = center_x + col * spacing - offset_x
        y = altitude  # Y is UP in NUE
        z = center_z + row * spacing - offset_z
        positions.append((x, y, z))

    return positions


def main():
    parser = argparse.ArgumentParser(description="AutoM8te Drone Spawner")
    parser.add_argument("--count", type=int, default=4, help="Number of drones to spawn")
    parser.add_argument("--spacing", type=float, default=5.0, help="Spacing between drones (meters)")
    parser.add_argument("--altitude", type=float, default=0.5, help="Spawn altitude (meters)")
    parser.add_argument("--center-x", type=float, default=0.0, help="Center X of spawn grid (North)")
    parser.add_argument("--center-z", type=float, default=0.0, help="Center Z of spawn grid (East)")
    parser.add_argument("--camera-port-base", type=int, default=5600, help="Base camera stream port")

    args = parser.parse_args()

    supervisor = Supervisor()

    print(f"[AutoM8te] Spawning {args.count} Iris drones...")
    print(f"[AutoM8te] Spacing: {args.spacing}m, Altitude: {args.altitude}m")

    # Get the root node to add children
    root = supervisor.getRoot()
    children_field = root.getField("children")

    positions = compute_spawn_positions(
        args.count, args.spacing,
        args.center_x, args.center_z, args.altitude
    )

    spawned_drones = []

    for i, (x, y, z) in enumerate(positions):
        camera_port = args.camera_port_base + i

        drone_string = DRONE_TEMPLATE.format(
            id=i,
            x=x, y=y, z=z,
            camera_port=camera_port,
        )

        children_field.importMFNodeFromString(-1, drone_string)
        spawned_drones.append({
            "id": i,
            "name": f"drone_{i}",
            "position": (x, y, z),
            "camera_port": camera_port,
        })

        print(f"[AutoM8te] Spawned drone_{i} at ({x:.1f}, {y:.1f}, {z:.1f}) → CAM:{camera_port}")

    print(f"[AutoM8te] All {args.count} Iris drones spawned!")
    print(f"[AutoM8te] Start SITL instances:")
    for i in range(args.count):
        print(f"[AutoM8te]   sim_vehicle.py -v ArduCopter --model webots-python -I{i}")

    print(f"[AutoM8te] Entering monitoring loop...")

    # Monitor loop — track drone positions for telemetry
    while supervisor.step(TIME_STEP) != -1:
        # Future: telemetry logging, collision detection, health monitoring
        pass


if __name__ == "__main__":
    main()
