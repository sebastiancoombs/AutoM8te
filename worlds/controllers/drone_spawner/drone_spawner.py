"""
AutoM8te Drone Spawner — Webots Supervisor Controller

Spawns N ArduPilot Iris drones into any Webots world at runtime.
Each drone gets a camera and connects to its own SITL instance.

Usage in .wbt file:
    Robot {
        name "spawner"
        controller "drone_spawner"
        controllerArgs ["--count", "4", "--spacing", "5", "--altitude", "0.5"]
        supervisor TRUE
    }

Each drone:
  - Uses ArduPilot's ardupilot_vehicle_controller
  - Gets assigned a unique SITL port (5760 + i*10)
  - Has a downward-facing camera for YOLO/perception
  - Spawns in a grid pattern with configurable spacing

Requires EXTERNPROTO declarations in the .wbt file for Iris.
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

# --- Drone PROTO template ---
# This spawns an Iris-like quadcopter with camera.
# If you have ArduPilot's Iris.proto available, use that instead.
# This inline definition works standalone without external protos.

DRONE_TEMPLATE = """
DEF DRONE_{id} Robot {{
  name "drone_{id}"
  translation {x} {y} {z}
  rotation 0 0 1 0
  controller "ardupilot_vehicle_controller"
  controllerArgs [
    "--motors"
    "m1_motor, m2_motor, m3_motor, m4_motor"
    "--camera"
    "camera"
    "--camera-port"
    "{camera_port}"
    "--sitl-address"
    "127.0.0.1"
    "--sitl-port-start"
    "{sitl_port}"
  ]
  supervisor FALSE
  children [
    # --- Sensors required by ArduPilot ---
    Accelerometer {{
      name "accelerometer"
      xAxis TRUE
      yAxis TRUE
      zAxis TRUE
    }}
    Gyro {{
      name "gyro"
      xAxis TRUE
      yAxis TRUE
      zAxis TRUE
    }}
    InertialUnit {{
      name "inertial_unit"
    }}
    GPS {{
      name "gps"
    }}

    # --- Forward-facing camera for YOLO/perception ---
    Camera {{
      name "camera"
      translation 0.2 0 0
      rotation 0 0 1 0
      width 640
      height 480
      fieldOfView 1.2
      near 0.1
    }}

    # --- Body shape (simple box placeholder) ---
    Shape {{
      appearance PBRAppearance {{
        baseColor 0.2 0.2 0.2
        metalness 0.5
      }}
      geometry Box {{
        size 0.4 0.4 0.1
      }}
    }}

    # --- 4 Propellers ---
    Propeller {{
      shaftAxis 0 0 1
      centerOfThrust 0.13 0.13 0.02
      thrustConstants 0.00026 0
      torqueConstants 5.2e-06 0
      device RotationalMotor {{
        name "m1_motor"
        maxVelocity 600
      }}
      fastHelix Solid {{
        children [
          Shape {{
            appearance PBRAppearance {{
              baseColor 0.1 0.1 0.8
              metalness 0.3
            }}
            geometry Cylinder {{
              height 0.005
              radius 0.1
            }}
          }}
        ]
      }}
    }}
    Propeller {{
      shaftAxis 0 0 1
      centerOfThrust -0.13 0.13 0.02
      thrustConstants 0.00026 0
      torqueConstants -5.2e-06 0
      device RotationalMotor {{
        name "m2_motor"
        maxVelocity 600
      }}
      fastHelix Solid {{
        children [
          Shape {{
            appearance PBRAppearance {{
              baseColor 0.1 0.1 0.8
              metalness 0.3
            }}
            geometry Cylinder {{
              height 0.005
              radius 0.1
            }}
          }}
        ]
      }}
    }}
    Propeller {{
      shaftAxis 0 0 1
      centerOfThrust -0.13 -0.13 0.02
      thrustConstants 0.00026 0
      torqueConstants 5.2e-06 0
      device RotationalMotor {{
        name "m3_motor"
        maxVelocity 600
      }}
      fastHelix Solid {{
        children [
          Shape {{
            appearance PBRAppearance {{
              baseColor 0.8 0.1 0.1
              metalness 0.3
            }}
            geometry Cylinder {{
              height 0.005
              radius 0.1
            }}
          }}
        ]
      }}
    }}
    Propeller {{
      shaftAxis 0 0 1
      centerOfThrust 0.13 -0.13 0.02
      thrustConstants 0.00026 0
      torqueConstants -5.2e-06 0
      device RotationalMotor {{
        name "m4_motor"
        maxVelocity 600
      }}
      fastHelix Solid {{
        children [
          Shape {{
            appearance PBRAppearance {{
              baseColor 0.8 0.1 0.1
              metalness 0.3
            }}
            geometry Cylinder {{
              height 0.005
              radius 0.1
            }}
          }}
        ]
      }}
    }}
  ]
  boundingObject Box {{
    size 0.4 0.4 0.1
  }}
  physics Physics {{
    density -1
    mass 1.5
    centerOfMass 0 0 0
  }}
}}
"""


def compute_spawn_positions(count, spacing, center_x=0, center_y=0, altitude=0.5):
    """Compute grid spawn positions for N drones."""
    positions = []
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)

    # Center the grid
    offset_x = (cols - 1) * spacing / 2
    offset_y = (rows - 1) * spacing / 2

    for i in range(count):
        col = i % cols
        row = i // cols
        x = center_x + col * spacing - offset_x
        y = center_y + row * spacing - offset_y
        z = altitude
        positions.append((x, y, z))

    return positions


def main():
    parser = argparse.ArgumentParser(description="AutoM8te Drone Spawner")
    parser.add_argument("--count", type=int, default=4, help="Number of drones to spawn")
    parser.add_argument("--spacing", type=float, default=5.0, help="Spacing between drones (meters)")
    parser.add_argument("--altitude", type=float, default=0.5, help="Spawn altitude (meters)")
    parser.add_argument("--center-x", type=float, default=0.0, help="Center X of spawn grid")
    parser.add_argument("--center-y", type=float, default=0.0, help="Center Y of spawn grid")
    parser.add_argument("--sitl-port-base", type=int, default=5760, help="Base SITL port (increments by 10)")
    parser.add_argument("--camera-port-base", type=int, default=5600, help="Base camera stream port")

    args = parser.parse_args()

    supervisor = Supervisor()

    print(f"[AutoM8te] Spawning {args.count} drones...")
    print(f"[AutoM8te] Spacing: {args.spacing}m, Altitude: {args.altitude}m")
    print(f"[AutoM8te] SITL ports: {args.sitl_port_base} - {args.sitl_port_base + (args.count - 1) * 10}")

    # Get the root node to add children
    root = supervisor.getRoot()
    children_field = root.getField("children")

    positions = compute_spawn_positions(
        args.count, args.spacing,
        args.center_x, args.center_y, args.altitude
    )

    spawned_drones = []

    for i, (x, y, z) in enumerate(positions):
        sitl_port = args.sitl_port_base + i * 10
        camera_port = args.camera_port_base + i

        drone_string = DRONE_TEMPLATE.format(
            id=i,
            x=x, y=y, z=z,
            sitl_port=sitl_port,
            camera_port=camera_port,
        )

        children_field.importMFNodeFromString(-1, drone_string)
        spawned_drones.append({
            "id": i,
            "name": f"drone_{i}",
            "position": (x, y, z),
            "sitl_port": sitl_port,
            "camera_port": camera_port,
        })

        print(f"[AutoM8te] Spawned drone_{i} at ({x:.1f}, {y:.1f}, {z:.1f}) → SITL:{sitl_port} CAM:{camera_port}")

    print(f"[AutoM8te] All {args.count} drones spawned successfully!")
    print(f"[AutoM8te] Entering monitoring loop...")

    # Keep running to monitor drone positions
    while supervisor.step(TIME_STEP) != -1:
        # Future: telemetry logging, collision detection, etc.
        pass


if __name__ == "__main__":
    main()
