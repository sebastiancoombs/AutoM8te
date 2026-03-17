# AutoM8te

**Voice-controlled AI drone swarm with OpenClaw + YOLO object detection.**

One operator, multiple simulated drones, natural language commands.

---

## Status

**Phase 1: Simulation + Basic Control** (In Progress)

- ✅ Phase 0: Planning complete (PRD written, architecture finalized)
- 🔨 Phase 1: Dual simulation path implementation
  - ✅ Project structure created
  - ✅ **Swarm Manager (SITL):** FastAPI server, MAVSDK integration, REST API
  - ✅ **Swarm Manager (AirSim):** Python class-based, direct API control
  - ✅ MCP tools definition for OpenClaw integration
  - ✅ Configuration files (SITL, AirSim)
  - ✅ Launch scripts and setup documentation
  - ✅ Test scripts for both simulation paths
  - ⏳ ArduPilot SITL installation (environment setup)
  - ⏳ AirSim + Unreal Engine installation
  - ⏳ First successful voice-controlled takeoff (either path)

See [PRD.md](PRD.md) for full product requirements.  
See [SETUP.md](SETUP.md) for SITL setup or [docs/AIRSIM_SETUP.md](docs/AIRSIM_SETUP.md) for AirSim setup.

---

## Core Concept

- **Ground station** (laptop) runs OpenClaw + YOLO + drone control
- **Simulated drones** (SITL or AirSim/Unreal)
- **Voice commands** control individual drones or the whole swarm
- **Object tracking** — "Follow that car", "Circle that person"
- **Skills-based** — new behaviors added as OpenClaw skills

---

## Architecture

### Dual Simulation Paths

**Path A: SITL + MAVSDK (ArduPilot)**
```
OpenClaw → FastAPI Swarm Manager → MAVSDK → ArduPilot SITL
```
- More realistic flight physics
- Standard MAVLink protocol
- Production-ready architecture (REST API)

**Path B: AirSim + Unreal Engine**
```
OpenClaw → Python Swarm Manager → AirSim Python API → Unreal Engine
```
- Photorealistic rendering for YOLO CV
- Direct Python control (simpler)
- Better visual feedback

Both paths are valid. Choose based on priorities:
- **SITL:** Realistic flight dynamics, standard protocols
- **AirSim:** Visual fidelity, easier CV integration

---

## Tech Stack

- **Orchestration:** OpenClaw
- **Drone Control:** MAVSDK (SITL) or AirSim Python API (Unreal)
- **Object Detection:** YOLOv8 (cars, people, 80+ classes)
- **Computer Vision:** MediaPipe (pose/gesture, supplementary)
- **Voice:** ElevenLabs STT/TTS
- **Simulation:** ArduPilot SITL or AirSim + Unreal Engine 5

---

## Development Plan (Simulation Only)

1. **Phase 1:** Single drone basic control (either SITL or AirSim)
2. **Phase 2:** YOLO object detection integration
3. **Phase 3:** Follow-object behavior (cars, people)
4. **Phase 4:** Multi-drone coordination (4 drones)
5. **Phase 5:** Advanced skills (formation, search, orbit)

**Hardware implementation is a separate future phase, not in this PRD.**

---

## Quick Start

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Choose Your Simulation Path

#### Path A: SITL + ArduPilot

See [SETUP.md](SETUP.md) for detailed instructions.

```bash
# Terminal 1: Start SITL
export ARDUPILOT_PATH=~/ardupilot
./scripts/launch_sitl.sh

# Terminal 2: Start Swarm Manager
./scripts/start_swarm_manager.sh

# Terminal 3: Test drone control
./scripts/test_single_drone.sh
```

#### Path B: AirSim + Unreal

See [docs/AIRSIM_SETUP.md](docs/AIRSIM_SETUP.md) for detailed instructions.

```bash
# Make sure AirSim/Unreal is running, then:
python tests/test_airsim_connection.py
```

Expected: Single drone takes off, moves forward 10m, lands.

---

## Project Structure

```
AutoM8te/
├── PRD.md                          # Product requirements
├── README.md                       # This file
├── SETUP.md                        # SITL setup guide
├── requirements.txt                # Python dependencies
├── config/
│   └── airsim_settings.json        # AirSim multi-drone config
├── docs/
│   ├── AIRSIM_SETUP.md             # AirSim installation guide
│   └── PHASE1_CHECKLIST.md         # Phase 1 progress tracker
├── openclaw_tools/
│   └── mcp_tools.json              # MCP tools for OpenClaw
├── scripts/
│   ├── launch_sitl.sh              # Launch ArduPilot SITL
│   ├── start_swarm_manager.sh      # Start FastAPI server
│   └── test_single_drone.sh        # Test SITL control
├── swarm_manager/                  # SITL-based implementation
│   ├── __init__.py
│   ├── server.py                   # FastAPI REST API
│   ├── drone_registry.py           # Drone state tracking
│   └── command_router.py           # Command parsing
├── src/
│   ├── airsim_bridge.py            # AirSim API integration
│   └── swarm_manager/              # AirSim-based implementation
│       ├── __init__.py
│       ├── drone.py                # Drone class
│       └── manager.py              # Swarm orchestration
└── tests/
    ├── test_airsim_connection.py   # AirSim test
    └── test_drone_registry.py      # SITL Swarm Manager test
```

---

## Next Steps

See [docs/PHASE1_CHECKLIST.md](docs/PHASE1_CHECKLIST.md) for detailed Phase 1 roadmap.

**Priority:** Install either SITL or AirSim, validate basic control, then integrate OpenClaw MCP tools.

---

## License

TBD

---

**This is a simulation-focused project. Hardware is deferred until software architecture is validated.**
