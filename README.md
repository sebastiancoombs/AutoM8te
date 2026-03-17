# AutoM8te

**Voice-controlled AI drone swarm with OpenClaw + YOLO object detection.**

One operator, multiple simulated drones, natural language commands.

---

## Status

**Phase 1: AirSim + Basic Control** (In Progress)

✅ Completed:
- Swarm Manager core (drone state, registry, collision detection)
- AirSim Bridge (API integration, telemetry, control)
- Test script for connection validation
- Setup documentation

🚧 Next:
- Install AirSim + Unreal Engine
- Test hardware-in-loop connection
- Build OpenClaw MCP tools
- Add voice command layer

See [docs/PHASE1_CHECKLIST.md](docs/PHASE1_CHECKLIST.md) for detailed progress.  
See [PRD.md](PRD.md) for full product requirements.

---

## Core Concept

- **Ground station** (laptop) runs OpenClaw + YOLO + AirSim control
- **Simulated drones** in Unreal Engine (AirSim)
- **Voice commands** control individual drones or the whole swarm
- **Object tracking** — "Follow that car", "Circle that person"
- **Skills-based** — new behaviors added as OpenClaw skills

---

## Architecture

```
Ground Station (OpenClaw + YOLO)
  ↓ AirSim Python API
Unreal Engine 5 (AirSim)
  - 4x Simulated Drones
  - Urban environment (cars, people, buildings)
  - Photorealistic rendering for CV
```

**Key decision:** Prove it in simulation before building hardware.

---

## Tech Stack

- **Orchestration:** OpenClaw
- **Object Detection:** YOLOv8 (cars, people, 80+ classes)
- **Computer Vision:** MediaPipe (pose/gesture, supplementary)
- **Voice:** ElevenLabs STT/TTS
- **Simulation:** AirSim + Unreal Engine 5
- **Control:** AirSim Python API

---

## Development Plan (Simulation Only)

1. **Phase 1:** Single drone basic control in AirSim
2. **Phase 2:** YOLO object detection integration
3. **Phase 3:** Follow-object behavior (cars, people)
4. **Phase 4:** Multi-drone coordination (4 drones)
5. **Phase 5:** Advanced skills (formation, search, orbit)

**Hardware implementation is a separate future phase, not in this PRD.**

---

## Quick Start

### 1. Install Dependencies

```bash
# Python dependencies
pip install -r requirements.txt
```

### 2. Setup AirSim

Follow [docs/AIRSIM_SETUP.md](docs/AIRSIM_SETUP.md) to install:
- Unreal Engine 5
- AirSim (built from source)
- Test environment (Blocks recommended)

### 3. Test Connection

```bash
# Make sure AirSim is running, then:
python tests/test_airsim_connection.py
```

Expected: Single drone takes off, moves forward 10m, lands.

### 4. Next Steps

See [docs/PHASE1_CHECKLIST.md](docs/PHASE1_CHECKLIST.md) for development roadmap.

---

## License

TBD

---

**This is a simulation-focused project. Hardware is deferred until software architecture is validated.**
