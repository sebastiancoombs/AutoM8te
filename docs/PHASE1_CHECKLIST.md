# Phase 1 Checklist: AirSim + Basic Control

**Goal:** Single drone responds to voice commands in AirSim.

---

## Setup Tasks

- [ ] Install Unreal Engine 5 via Epic Games Launcher
- [ ] Build AirSim from source (`./setup.sh && ./build.sh`)
- [ ] Download or create environment (Blocks recommended for testing)
- [ ] Configure `~/Documents/AirSim/settings.json` (4 drones)
- [ ] Install Python dependencies (`pip install -r requirements.txt`)
- [ ] Test AirSim connection (`python tests/test_airsim_connection.py`)

---

## Development Tasks

- [x] Create project structure (src/, tests/, docs/, config/)
- [x] Write `swarm_manager/drone.py` (Drone state tracking)
- [x] Write `swarm_manager/manager.py` (SwarmManager orchestration)
- [x] Write `airsim_bridge.py` (AirSim API integration)
- [x] Write `test_airsim_connection.py` (basic control test)
- [x] Document AirSim setup (docs/AIRSIM_SETUP.md)
- [ ] Create OpenClaw MCP tools for drone control
- [ ] Integrate ElevenLabs voice commands (STT → intent → action)
- [ ] Build voice command parser (natural language → drone commands)
- [ ] Test: "Take off" → drone takes off
- [ ] Test: "Move forward 10 meters" → drone moves
- [ ] Test: "Land" → drone lands
- [ ] Add telemetry logging to file (position, velocity, state over time)

---

## Success Criteria (Phase 1 Complete)

- [ ] OpenClaw routes voice commands to AirSim API calls
- [ ] Drone responds correctly in simulation
- [ ] Telemetry visible in logs (position, orientation, state)
- [ ] Camera feed accessible from Python
- [ ] Documentation complete (setup + usage)

---

## Current Status

**What works:**
- ✅ Swarm Manager (drone registry, state tracking)
- ✅ AirSim Bridge (connect, takeoff, move, land, telemetry)
- ✅ Basic test script (validates connection + control)
- ✅ Setup documentation (AIRSIM_SETUP.md)

**Next priorities:**
1. Install AirSim + test environment
2. Run test_airsim_connection.py (validate hardware-in-loop)
3. Create OpenClaw tools (drone_move, drone_query, etc.)
4. Add voice command layer (ElevenLabs STT + intent parsing)

---

## Notes

- Focus on single drone first (Drone0)
- Multi-drone coordination is Phase 4
- YOLO integration is Phase 2
- Voice is essential for Phase 1 completion (validates full loop)
