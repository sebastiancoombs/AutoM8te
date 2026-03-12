# AutoM8te - Product Requirements Document

**Version:** 0.2  
**Date:** March 12, 2026  
**Status:** Simulation-Focused Draft  
**Scope:** Simulation validation only — hardware implementation deferred to future phase

---

## Vision

**Build and validate a voice-controlled AI drone swarm system in simulation where one human operator coordinates multiple drones through natural language commands and computer vision.**

Core principles:
- **One brain, multiple bodies** — All intelligence lives on ground station, drones are simulated actuators
- **Object-aware intelligence** — Track and follow any object (people, cars, animals) via YOLO + CV
- **Skills-based flexibility** — New capabilities added as OpenClaw skills, not hardcoded features
- **Prove in simulation first** — Validate all behaviors in AirSim before considering hardware

---

## The Problem

Current drone control requires:
- Manual piloting skills for complex maneuvers
- No coordination between multiple drones
- Limited object recognition (manual targeting)
- Programming new behaviors requires recompiling firmware

**We want:** Natural language commands ("follow that car"), autonomous object tracking, multi-drone coordination, and hot-swappable skills.

**We will prove it works in simulation before building hardware.**

---

## Core Architecture

```
┌────────────────────────────────────────────┐
│         Ground Station (OpenClaw)          │
│                                            │
│  Voice Input → Intent Recognition          │
│  Video Feeds → YOLO + CV Pipeline          │
│  Skills Layer → Control Generation         │
│  Audio Output → TTS Feedback               │
└────────────────────────────────────────────┘
                    ↕ (AirSim API)
┌─────────────────────────────────────────────┐
│           AirSim (Unreal Engine)            │
│                                             │
│  ┌──────────┬──────────┬──────────────┐    │
│  │ Drone 1  │ Drone 2  │ Drone 3 & 4  │    │
│  │ Camera   │ Camera   │ Cameras      │    │
│  │ Physics  │ Physics  │ Physics      │    │
│  └──────────┴──────────┴──────────────┘    │
│                                             │
│  Environment: Urban scene with cars,        │
│              people, buildings              │
└─────────────────────────────────────────────┘
```

### Design Decision: Simulation-First

**Why simulation only (for now)?**
- ✅ Prove architecture works before hardware spend
- ✅ Iterate faster (no battery swaps, no crash repairs)
- ✅ Test dangerous scenarios safely (collision avoidance, signal loss)
- ✅ Photorealistic CV (AirSim + Unreal Engine)
- ✅ Perfect telemetry (no sensor noise)

**Why AirSim specifically?**
- ✅ Unreal Engine rendering (best CV quality)
- ✅ Multiple camera views per drone
- ✅ Python API for control
- ✅ Supports object spawning (cars, people, obstacles)
- ✅ Multi-drone support out of the box

**Hardware deferred:** Once simulation validates all behaviors, hardware becomes a mechanical engineering problem (not a software risk).

---

## Technical Stack

### Ground Station
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Orchestration** | OpenClaw | Skills-based, LLM integration, proven runtime |
| **Language** | Python | Best drone + CV libraries |
| **Object Detection** | YOLOv8 | Fast, accurate, multi-class detection (people, cars, animals) |
| **Computer Vision** | MediaPipe | Pose + gesture detection (supplementary to YOLO) |
| **Voice I/O** | ElevenLabs API | High quality STT/TTS, low latency |
| **Simulation Control** | AirSim Python API | Direct control, telemetry, camera access |
| **Video Processing** | OpenCV | Frame capture, pre-processing for YOLO |

### Simulation Environment
- **AirSim** — Unreal Engine-based drone simulator
- **Unreal Engine 5** — Photorealistic rendering for CV
- **Python API** — Control interface (waypoints, velocity, camera)
- **Multi-drone support** — Native in AirSim settings

---

## Core Components

### 1. Drone Swarm Manager (Custom Service)

**Drone Registry:**
- Tracks state of N drones (ID, position, orientation, task, camera feed)
- Updates telemetry from AirSim API (position, velocity, collision state)

**Command Router:**
- Parses intent: "Drone 2, follow that car" → `{target: "drone_2", action: "follow", object: "car"}`
- Routes to specific drone or broadcasts to all
- Handles addressing modes: individual, group, broadcast

**Collision Avoidance:**
- Tracks positions of all active drones via AirSim telemetry
- Predicts movement paths
- Overrides commands if collision risk detected (5m minimum separation)

**Object Tracker:**
- Maintains registry of detected objects (ID, class, position, velocity)
- Associates OpenClaw intent with YOLO detections
- Resolves ambiguity ("that car" → which car? closest? pointed at?)

### 2. OpenClaw Integration

**Custom Tools (to build):**
```python
drone_move(drone_id, x, y, z, yaw)  # Move to position (NED coords)
drone_velocity(drone_id, vx, vy, vz)  # Set velocity vector
drone_query(drone_id)  # Read telemetry (position, orientation, collision state)
drone_broadcast(command)  # Send to all drones
detect_objects(drone_id, classes=["car", "person"])  # YOLO detection from camera
track_object(drone_id, object_id)  # Follow specific detected object
```

**Skills (examples):**
- `follow-object` — YOLO tracks object (car, person, animal), drone maintains follow distance
- `patrol-route` — Autonomous waypoint navigation in AirSim environment
- `formation-flight` — Multi-drone coordination with relative positioning
- `search-pattern` — Coverage algorithm, coordinate multiple drones
- `orbit-object` — Circle around detected object at fixed radius

### 3. Computer Vision Pipeline

**Input:** AirSim camera feed (RGB images, 30+ fps, 1080p)  
**Processing Pipeline:**
1. **YOLO v8** — Object detection (80+ classes: person, car, truck, dog, etc.)
2. **MediaPipe** (optional) — Pose/gesture for human interaction
3. **Object Tracking** — Maintain ID across frames (SORT/DeepSORT)
4. **Spatial Positioning** — Estimate 3D position from bounding box + camera intrinsics

**Output:** List of detected objects with:
- Class (car, person, dog, etc.)
- Bounding box (pixel coords)
- Confidence score
- Tracking ID (persistent across frames)
- Estimated 3D position (relative to drone)

**Example Use Cases:**
- "Follow that car" → YOLO detects cars, user points or specifies ("red car"), drone tracks
- "Circle around that person" → YOLO + MediaPipe detects person, drone orbits
- "Avoid all obstacles" → YOLO detects objects, collision avoidance uses positions

### 4. Voice Interface

**Input:** Ground station mic → ElevenLabs STT  
**Processing:** OpenClaw LLM parses intent, routes to skill  
**Output:** TTS audio → ground station speakers (for simulation)

**Addressing modes:**
- **"Drone 2, follow that car"** → Targets specific drone
- **"All drones, return home"** → Broadcasts to all
- **"Scout team, patrol north"** → Group addressing (Drones 1-3)

**Feedback loop:**
- User command → OpenClaw processes → skill executes → TTS response
- Response format: "[Drone 2]: Following red sedan"
- Console logging for debugging, audio feedback for natural interaction

---

## Development Phases

### Phase 0: Repository Setup ✅
- Create GitHub repo
- Write PRD (this document)
- Define architecture
- Choose tech stack

### Phase 1: AirSim + Basic Control (Week 1-2)
**Goal:** Single drone responds to voice commands in AirSim.

**Tasks:**
- Install AirSim + Unreal Engine 5
- Configure urban environment (Blocks or City scene)
- Connect OpenClaw to AirSim Python API
- Voice command: "Take off" → drone takes off
- Voice command: "Move forward 10 meters" → drone moves
- Voice command: "Land" → drone lands
- Verify telemetry reads correctly (position, orientation, collision state)

**Success criteria:**
- [ ] OpenClaw routes voice commands to AirSim API calls
- [ ] Drone responds correctly in simulation
- [ ] Telemetry visible in logs
- [ ] Camera feed accessible from Python

### Phase 2: YOLO Object Detection (Week 3-4)
**Goal:** Drone detects and identifies objects in AirSim environment.

**Tasks:**
- Integrate YOLOv8 with AirSim camera feed
- Spawn objects in AirSim (cars, people, obstacles)
- Test detection: verify YOLO correctly identifies spawned objects
- Implement object tracking (maintain ID across frames)
- Display bounding boxes + labels in debug view

**Success criteria:**
- [ ] YOLO detects cars, people, obstacles in AirSim renders
- [ ] Detection runs at 20+ fps (fast enough for control)
- [ ] Object IDs persist across frames (tracking works)
- [ ] False positive rate <10% (reliable detection)

### Phase 3: Follow-Object Behavior (Week 5-6)
**Goal:** Drone tracks and follows detected objects via voice command.

**Tasks:**
- Voice command: "Follow that car" → drone identifies closest car, begins following
- Implement PID control: keep object centered in frame
- Maintain safe distance (5-10m behind object)
- Handle object loss (car drives behind building → drone hovers, waits)
- Test with moving vehicles in AirSim

**Success criteria:**
- [ ] Drone locks onto specified object (car, person, etc.)
- [ ] Maintains follow distance without oscillation
- [ ] Recovers when object temporarily occluded
- [ ] Voice command switches targets: "Follow that person instead"

### Phase 4: Multi-Drone Coordination (Week 7-8)
**Goal:** Control 4 drones independently in same AirSim environment.

**Tasks:**
- Spawn 4 drones in AirSim (configured via settings.json)
- Implement Drone Registry (track state of each)
- Test individual addressing: "Drone 2, follow that car"
- Test broadcast: "All drones, land"
- Implement collision avoidance (5m minimum separation)
- Test: send two drones toward same target, verify avoidance

**Success criteria:**
- [ ] All 4 drones controllable independently
- [ ] Addressing works correctly (individual, broadcast, group)
- [ ] Collision avoidance prevents simulated crashes
- [ ] Each drone can track different objects simultaneously

### Phase 5: Advanced Coordination (Week 9-10)
**Goal:** Complex multi-drone behaviors (formation, search patterns).

**Tasks:**
- Formation flight: maintain diamond/line formation while following object
- Search pattern: 4 drones cover area systematically
- Orbit mode: drones circle object from different angles
- Coordinated landing: all drones land in sequence without collision

**Success criteria:**
- [ ] Formation flight maintains shape during maneuvers
- [ ] Search pattern achieves >90% area coverage
- [ ] Orbit mode: 4 drones at 90° intervals around object
- [ ] Coordinated behaviors composable (can combine skills)

---

## User Experience

### Typical Use Case: 3-Drone Object Tracking in AirSim

**Setup:**
1. Launch AirSim with urban environment
2. Start OpenClaw ground station
3. Spawn 3 drones in simulation
4. Spawn traffic (cars, pedestrians)

**Mission:**
1. **Operator:** "All drones, take off"  
   **System:** [All 3 drones lift to 5m hover in AirSim]  
   **Feedback:** "All drones airborne"

2. **Operator:** "Drone 1, follow that red car"  
   **System:** [YOLO detects cars, identifies red vehicle, Drone 1 locks on]  
   **Drone 1:** "Following red sedan, maintaining 8 meters"

3. **Operator:** "Drone 2, circle around that person"  
   **System:** [YOLO + MediaPipe detect person, Drone 2 begins orbit at 10m radius]  
   **Drone 2:** "Orbiting target, 360 coverage active"

4. **Operator:** "Drone 3, patrol between waypoints Alpha and Bravo"  
   **System:** [Drone 3 flies predetermined route]  
   **Drone 3:** "Patrol active"

5. [Red car turns corner, drives behind building]  
   **Drone 1:** "Target occluded, holding position"  
   [Car emerges 5 seconds later]  
   **Drone 1:** "Target reacquired, resuming follow"

6. **Operator:** "Drone 1, switch to that blue truck instead"  
   **System:** [YOLO re-targets, Drone 1 switches to blue truck]  
   **Drone 1:** "Now following blue pickup truck"

7. **Operator:** "All drones, land at home position"  
   **System:** [All drones return to launch coordinates, land sequentially]  
   **Feedback:** "All drones landed"

**Key UX principles:**
- Voice is primary interface
- Object recognition enables natural commands ("that car", "the person")
- Autonomous tracking with proactive status updates
- Graceful handling of edge cases (occlusion, object loss)
- Multi-drone coordination without operator micromanagement

---

## Success Criteria (Simulation Only)

### Phase 1: AirSim + Basic Control
- [ ] Voice command makes drone take off in AirSim
- [ ] Voice command moves drone to specific coordinates
- [ ] Voice command lands drone
- [ ] Telemetry reads correctly (position, orientation, collision state)
- [ ] Camera feed accessible and displays AirSim renders

### Phase 2: YOLO Object Detection
- [ ] YOLO detects cars in AirSim environment (>90% accuracy)
- [ ] YOLO detects people in AirSim environment (>90% accuracy)
- [ ] Detection runs at 20+ fps (real-time)
- [ ] Object tracking maintains IDs across frames
- [ ] False positive rate <10%

### Phase 3: Follow-Object Behavior
- [ ] Voice: "Follow that car" → drone locks onto closest car
- [ ] Drone maintains 5-10m follow distance
- [ ] PID control prevents oscillation (<1m position error)
- [ ] Drone handles object occlusion (waits, resumes)
- [ ] Voice: "Follow that person instead" → switches targets correctly

### Phase 4: Multi-Drone Coordination
- [ ] 4 drones spawn in AirSim without collision
- [ ] Individual addressing: "Drone 2, take off" (others stay grounded)
- [ ] Broadcast: "All drones, land" (all execute)
- [ ] Collision avoidance: 2 drones sent toward same point → maintain 5m separation
- [ ] Each drone can track different object simultaneously

### Phase 5: Advanced Coordination
- [ ] Formation flight: 4 drones maintain diamond formation for 60+ seconds
- [ ] Search pattern: 4 drones achieve >90% area coverage
- [ ] Orbit mode: 4 drones at 90° intervals around object
- [ ] Coordinated landing: all drones land without collision
- [ ] Skills composable: formation + follow-object works together

**Project complete when all Phase 5 criteria met.**  
**Hardware implementation is a separate future phase, not in this PRD.**

---

## Non-Goals (Simulation Phase)

**Out of scope for this PRD:**
- **Hardware implementation** — deferred to future phase after simulation validation
- Real-world physics challenges (wind, GPS drift, battery management)
- Racing/aerobatics (focus on autonomous tracking, not manual piloting augmentation)
- Indoor navigation (AirSim outdoor/urban environments only)
- Object manipulation (no grippers, delivery mechanisms)
- Advanced ML (reinforcement learning, custom vision models beyond YOLO)

**Why:** Prove the architecture and core behaviors in simulation first. Hardware is a deployment detail, not a software architecture risk.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **YOLO false positives** (detects non-existent objects) | High | Confidence threshold tuning, secondary validation (tracking consistency) |
| **AirSim performance** (low fps, stuttering) | High | Reduce graphics quality, use simpler environment, upgrade GPU if needed |
| **Object tracking loss** (ID switches between frames) | Medium | Use DeepSORT (appearance-based), not just IOU matching |
| **Collision avoidance false positives** | Medium | Conservative min distance (5m), log all overrides for analysis |
| **Skills conflict** (two skills want control) | Medium | Priority system (safety > autonomous > idle), skill orchestration layer |
| **AirSim API limitations** | Medium | Test early, fall back to ROS bridge if Python API insufficient |
| **Unreal Engine crashes** | Low | Save environment frequently, automate scene setup via scripts |

---

## Open Questions

1. **YOLO model size:** YOLOv8 nano/small/medium/large? (Speed vs accuracy tradeoff)
2. **Object selection ambiguity:** "Follow that car" when 5 cars visible — how to resolve? Closest? Pointing gesture? Explicit ("the red one")?
3. **AirSim multi-drone performance:** Can one laptop run 4 drones + YOLO + Unreal rendering at 30fps?
4. **Tracking persistence:** How long should drone remember an object after occlusion before giving up?
5. **Formation rigidity:** Fixed formation (diamond always) or dynamic (adapt to obstacles)?

**Resolution path:** Build Phase 1-2, answers will emerge from testing. Document decisions as we go.

---

## Next Steps

- [x] Create repo
- [x] Write PRD (simulation-scoped)
- [ ] Install AirSim + Unreal Engine 5
- [ ] Configure AirSim with urban environment (Blocks or City)
- [ ] Install YOLOv8 + test on sample images
- [ ] Set up OpenClaw → AirSim Python API connection
- [ ] Implement Phase 1: Single drone basic control
- [ ] Document AirSim setup in README.md

---

**This PRD is simulation-focused. Hardware implementation is a separate future phase.**  
**Expect this document to evolve as we learn from testing.**
