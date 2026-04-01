# AutoM8te

**Voice-controlled AI drone swarm with OpenClaw + YOLO object detection.**

One operator, multiple simulated drones, natural language commands.

---

## Quick Start

```bash
# Launch with 4 drones (default)
./launch.sh

# Launch with 8 drones
./launch.sh 8

# Headless mode (no Webots, SITL + intent layer only)
./launch.sh 4 --no-webots
```

**What `launch.sh` does:**
1. Updates the Webots world file with N Iris drone nodes
2. Starts N ArduPilot SITL instances (one per drone)
3. Launches Webots with the city environment
4. Starts the intent layer HTTP server on port 8080

**Ctrl+C stops everything cleanly.**

### Prerequisites

| Dependency | Install |
|-----------|---------|
| **ArduPilot SITL** | `cd ~/ardupilot && ./waf configure --board sitl && ./waf copter` |
| **Webots R2025a** | [Download](https://cyberbotics.com/doc/guide/installation-procedure) → `/Applications/Webots.app` |
| **pymavlink** | `pip3 install pymavlink` |
| **Node.js** | `brew install node` |

### API (port 8080)

```bash
# Check status
curl http://localhost:8080/api/status

# List available tools
curl http://localhost:8080/api/tools

# Send a command
curl -X POST http://localhost:8080/api/tool \
  -H 'Content-Type: application/json' \
  -d '{"name": "drone_command", "args": {"action": "takeoff"}}'
```

---

## Architecture

```
Voice / OpenClaw / HTTP
        ↓
Intent Layer (Node.js :8080)
  - 9 tools: command, move, query, formation, search, follow, etc.
  - Group management, collision avoidance
  - Perception (YOLO bridge)
        ↓
ArduPilot Bridge (pymavlink)
        ↓
N × ArduPilot SITL instances
        ↕
Webots (Unreal-quality rendering)
  - Iris drone models with cameras
  - City environment (roads, cars, buildings, pedestrians)
  - Physics simulation
```

**Key decision:** All compute on ground station. Drones are lightweight actuators.

---

## Project Structure

```
AutoM8te/
├── launch.sh                       # One-command startup
├── PRD.md                          # Product requirements
├── worlds/
│   └── autom8te_city.wbt           # Webots city environment
├── protos/
│   ├── Iris.proto                  # Iris drone model
│   └── meshes/                     # 3D meshes
├── controllers/
│   ├── ardupilot_vehicle_controller/
│   │   ├── ardupilot_vehicle_controller.py  # Webots ↔ SITL bridge
│   │   └── webots_vehicle.py                # Vehicle class
│   └── drone_spawner/
│       └── add_drones.py           # Add N drones to world file
├── intent-layer/                   # HTTP API + tool routing
│   ├── server.js                   # Main server
│   ├── adapters/
│   │   ├── ardupilot.js            # ArduPilot SITL adapter
│   │   ├── ardupilot_bridge.py     # pymavlink bridge
│   │   ├── mock.js                 # Mock adapter (no sim)
│   │   └── ...
│   ├── lookups/                    # Formations, directions, patterns
│   ├── perception/
│   │   ├── detector.js             # Object detection interface
│   │   └── yolo_bridge.py          # YOLO integration
│   └── state/
│       └── groups.js               # Drone group management
└── memory/                         # Build session notes
```

---

## Tech Stack

- **Orchestration:** OpenClaw (skills-based, LLM integration)
- **Simulation:** ArduPilot SITL + Webots R2025a
- **Intent Layer:** Node.js (HTTP API, 9 tools)
- **Flight Bridge:** pymavlink (ArduPilot ↔ intent layer)
- **Object Detection:** YOLOv8 (Phase 2)
- **Voice:** OpenAI Realtime API (built, tested)

---

## Development Plan

1. **Phase 1:** ✅ Basic control — SITL + Webots + intent layer
2. **Phase 2:** ⏳ YOLO object detection from drone cameras
3. **Phase 3:** Follow-object behavior ("follow that car")
4. **Phase 4:** Multi-drone coordination (4+ drones)
5. **Phase 5:** Advanced skills (formation, search, orbit)

Hardware implementation is a separate future phase.

---

## License

TBD
