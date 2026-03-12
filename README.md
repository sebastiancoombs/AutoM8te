# AutoM8te

**Voice-controlled AI drone swarm with OpenClaw.**

One operator, multiple drones, natural language commands.

---

## Status

**Phase 0: Planning** (PRD complete)

See [PRD.md](PRD.md) for full product requirements.

---

## Core Concept

- **Ground station** (laptop) runs OpenClaw + computer vision
- **Drones** (racing quads) are lightweight actuators with cameras + speakers
- **Voice commands** control individual drones or the whole swarm
- **Manual override** always available (RC controller in hand)
- **Skills-based** — new behaviors added without recompiling firmware

---

## Architecture

```
Ground Station (OpenClaw)
  ↓ Digital Video + CRSF Control
Racing Drones (5-inch quads)
  - DJI O3 / HDZero (video)
  - ExpressLRS (control)
  - Bluetooth speaker (voice feedback)
```

**Key decision:** All compute on ground, drones stay light and cheap.

---

## Tech Stack

- **Orchestration:** OpenClaw
- **Control:** CRSF protocol via MAVSDK-Python
- **Computer Vision:** MediaPipe (pose + gesture detection)
- **Voice:** ElevenLabs STT/TTS
- **Simulation:** ArduPilot SITL + Gazebo

---

## Development Plan

1. **Phase 1:** Single drone in simulation (SITL)
2. **Phase 2:** Follow-me with synthetic video
3. **Phase 3:** Multi-drone coordination (sim)
4. **Phase 4:** First real hardware flight
5. **Phase 5:** Real follow-me outdoors
6. **Phase 6:** Multi-drone real flight
7. **Phase 7:** Advanced skills (formation, search, swarm)

---

## Setup (Coming Soon)

Installation and simulation setup instructions will be added as Phase 1 progresses.

---

## License

TBD

---

**This is an experimental project. Expect rapid iteration and breaking changes.**
