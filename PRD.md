# AutoM8te - Product Requirements Document

**Version:** 0.1  
**Date:** March 12, 2026  
**Status:** Initial Draft  

---

## Vision

**Build a voice-controlled AI drone swarm system where one human operator coordinates multiple drones through natural language and gesture commands.**

Core principles:
- **One brain, multiple bodies** — All intelligence lives on ground station, drones are lightweight actuators
- **Always in control** — Manual RC override available instantly, AI augments (never replaces) human pilot
- **Skills-based flexibility** — New capabilities added as OpenClaw skills, not hardcoded features
- **Spatial audio feedback** — Each drone speaks from the air, creating intuitive team coordination

---

## The Problem

Current drone control requires:
- Dedicated RC transmitter per task (racing, cinematography, FPV)
- Manual piloting skills for complex maneuvers
- No coordination between multiple drones
- Programming new behaviors requires recompiling firmware

**We want:** Natural language commands, autonomous behaviors, multi-drone coordination, and hot-swappable skills.

---

## Core Architecture

```
┌────────────────────────────────────────────┐
│         Ground Station (OpenClaw)          │
│                                            │
│  Voice Input → Intent Recognition          │
│  Video Feeds → Computer Vision             │
│  Skills Layer → Control Generation         │
│  Audio Output → Per-Drone TTS              │
└────────────────────────────────────────────┘
                    ↕ (Digital Video + CRSF)
┌──────────┬──────────┬──────────┬──────────┐
│ Drone 1  │ Drone 2  │ Drone 3  │ Drone 4  │
│          │          │          │          │
│ - Camera │ - Camera │ - Camera │ - Camera │
│ - RC RX  │ - RC RX  │ - RC RX  │ - RC RX  │
│ - Speaker│ - Speaker│ - Speaker│ - Speaker│
│ - FC     │ - FC     │ - FC     │ - FC     │
└──────────┴──────────┴──────────┴──────────┘
```

### Design Decision: Ground-Based Compute

**Why not onboard compute?**
- Weight penalty (200g+ per drone for Pi + camera + mounts)
- Limited compute power (Pi 5 vs laptop/desktop)
- Harder debugging (logs/crashes in the air)
- More expensive (multiply by N drones)

**Why ground station?**
- ✅ Drones stay light, fast, cheap
- ✅ Powerful compute available (laptop/desktop)
- ✅ All debugging on ground
- ✅ Manual override always available (you're holding the controller)
- ✅ Easy to scale (same ground station controls N drones)

**Tradeoff accepted:** 100-200ms latency (video → processing → command). This is fine for most tasks (follow-me, patrol, formation). Not suitable for racing/aerobatics (but those stay manual anyway).

---

## Technical Stack

### Ground Station
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Orchestration** | OpenClaw | Skills-based, LLM integration, proven runtime |
| **Language** | Python | Best drone libraries, CV support |
| **Computer Vision** | MediaPipe | Fast, CPU-only, pose + gesture detection |
| **Voice I/O** | ElevenLabs API | High quality STT/TTS, low latency |
| **Video Input** | OpenCV + V4L2 | Standard capture, USB HDMI dongles |
| **Control Output** | CRSF protocol | Industry standard, bidirectional, low latency |
| **Audio Output** | Bluetooth A2DP | Wireless, per-drone routing |

### Drones (per unit)
- **Flight controller:** Betaflight (lightweight, proven)
- **Video TX:** DJI O3 Air Unit or HDZero (digital, 1080p clean)
- **RC receiver:** ExpressLRS (low latency, bidirectional telemetry)
- **Speaker:** Small Bluetooth (~50g, <$20)
- **Frame:** 5-inch racing quad (light, durable, fast)

### Simulation
- **ArduPilot SITL** for flight dynamics
- **Gazebo** (optional) for 3D visualization
- **MAVSDK-Python** for control (works in sim + real hardware)

---

## Core Components

### 1. Drone Swarm Manager (Custom Service)

**Drone Registry:**
- Tracks state of N drones (ID, battery, GPS, task, video feed, control channel)
- Updates telemetry in real-time (battery, position, signal strength)

**Command Router:**
- Parses intent: "Drone 2, follow me" → `{target: "drone_2", action: "follow"}`
- Routes to specific drone or broadcasts to all
- Handles addressing modes: individual, group, broadcast

**Collision Avoidance:**
- Tracks positions of all active drones
- Predicts movement paths
- Overrides commands if collision risk detected (5m minimum separation)

**Telemetry Aggregation:**
- Reads CRSF telemetry from all drones
- Surfaces to OpenClaw tools (`drone_query`, etc.)

### 2. OpenClaw Integration

**Custom Tools (to build):**
```python
drone_command(drone_id, roll, pitch, throttle, yaw)  # Send control
drone_query(drone_id)  # Read telemetry
drone_broadcast(command)  # Send to all drones
video_feed(drone_id)  # Get CV results
```

**Skills (examples):**
- `follow-me` — CV tracks person, drone maintains follow distance
- `patrol-route` — Autonomous waypoint navigation
- `formation-flight` — Multi-drone coordination with relative positioning
- `search-pattern` — Coverage algorithm, coordinate multiple drones
- `manual-assist` — AI augments stick inputs (stabilization, auto-level)

### 3. Computer Vision Pipeline

**Input:** Digital FPV feed (1080p) via USB HDMI capture  
**Processing:** MediaPipe Pose Landmarker (person tracking) + Hand Landmarker (gestures)  
**Output:** Person position, gesture classification → control commands

**Gesture Vocabulary (initial):**
- **Push away** → "back up"
- **Pull toward** → "come closer"
- **Point direction** → "go that way"
- **Stop sign** → "hover/stop"
- **Wave** → "return to me"

### 4. Voice Interface

**Input:** Ground station mic → ElevenLabs STT  
**Processing:** OpenClaw LLM parses intent, routes to skill  
**Output:** TTS audio → routed to specific drone's Bluetooth speaker  

**Addressing modes:**
- **"Drone 2, follow me"** → Targets specific drone
- **"All drones, return home"** → Broadcasts to all
- **"Scout team, patrol north"** → Group addressing (Drones 1-3)

**Feedback loop:**
- User command → OpenClaw processes → skill executes → TTS response
- Response plays from **targeted drone's speaker in the air**
- Spatial audio = you know which drone is responding

---

## Development Phases

### Phase 0: Repository Setup ✅
- Create GitHub repo
- Write PRD (this document)
- Define architecture
- Choose tech stack

### Phase 1: Simulation Foundation (Week 1-2)
**Goal:** Single drone responds to voice commands in simulation.

**Tasks:**
- Install ArduPilot SITL + MAVSDK-Python
- Launch simulated drone
- Voice command: "Arm" → drone arms (in sim)
- Voice command: "Take off" → drone takes off
- Voice command: "Land" → drone lands
- Verify telemetry reads correctly (battery, GPS, altitude)

**Success criteria:**
- OpenClaw routes voice commands to MAVSDK calls
- Drone responds correctly in SITL
- Telemetry visible in logs

### Phase 2: Computer Vision (Week 3-4)
**Goal:** Follow-me behavior works in simulation with synthetic video.

**Tasks:**
- Record 30-second video of person moving
- Run MediaPipe person detection on video
- Calculate control inputs to keep person centered in frame
- Send control to simulated drone
- Tune PID controllers (avoid oscillation)

**Success criteria:**
- Voice: "Follow me" → activates CV loop
- Simulated drone tracks person in synthetic video
- Smooth following (no wild oscillations)

### Phase 3: Multi-Drone Coordination (Week 5-6)
**Goal:** Control 4 drones independently in simulation.

**Tasks:**
- Spawn 4 SITL drones (unique ports)
- Implement Drone Registry (track state of each)
- Test individual addressing: "Drone 2, take off"
- Test broadcast: "All drones, land"
- Implement collision avoidance
- Test: fly two drones toward each other, verify override

**Success criteria:**
- All 4 drones controllable independently
- Addressing works correctly (individual, broadcast, group)
- Collision avoidance prevents crashes

### Phase 4: Hardware Prototype (Week 7-10)
**Goal:** One real drone responds to voice commands.

**Tasks:**
- Build/buy first racing quad (5-inch, digital video, ELRS)
- Connect ground station: HDMI capture, CRSF controller
- Port skills from MAVSDK to CRSF protocol
- Test basic commands: arm, takeoff, land
- Add Bluetooth speaker to drone
- Test voice feedback (TTS from drone)

**Success criteria:**
- One real drone flies via voice commands
- Video feed captured correctly
- Manual RC override works instantly
- Voice feedback audible from drone speaker

### Phase 5: Real Follow-Me (Week 11-12)
**Goal:** Real drone tracks and follows a person outdoors.

**Tasks:**
- Run MediaPipe on live FPV feed (not synthetic video)
- Tune PID for real flight dynamics (wind, lag, etc.)
- Test in open area (safety first)
- Implement failsafes (signal loss, battery low, person lost)

**Success criteria:**
- Drone tracks person smoothly
- Maintains safe distance (3-5m)
- Failsafes trigger correctly

### Phase 6: Multi-Drone Real Flight (Week 13-16)
**Goal:** 2-4 real drones coordinate in flight.

**Tasks:**
- Build/buy 2nd, 3rd, 4th drones (identical hardware)
- Test individual control of 2 drones
- Implement formation flight (maintain relative positions)
- Test collision avoidance in real flight
- Implement coordinated tasks (patrol, search)

**Success criteria:**
- All drones addressable independently
- Formation flight stable
- Collision avoidance prevents real crashes
- Coordinated patrol/search works

### Phase 7: Advanced Skills (Week 17+)
**Goal:** Rich skill library, swarm intelligence.

**Tasks:**
- `search-pattern` skill (coverage algorithm)
- `swarm-mode` skill (emergent behavior)
- `trick-mode` skill (coordinated aerobatics)
- `manual-assist` skill (AI-augmented piloting)
- Gesture control (hand signals → commands)

**Success criteria:**
- Each skill documented (SKILL.md)
- Skills hot-swappable (no recompile)
- Skills composable (combine for complex tasks)

---

## User Experience

### Typical Use Case: 3-Drone Patrol

**Setup:**
1. Operator powers on ground station (laptop)
2. Powers on 3 drones, they connect automatically
3. Operator hears confirmation from each: "Drone 1 ready", "Drone 2 ready", "Drone 3 ready"

**Mission:**
1. **Operator:** "All drones, arm"  
   **Drones:** [beep sounds from all 3]

2. **Operator:** "All drones, take off"  
   **Drones:** [all lift off to 2m hover]  
   **Drone 1:** "Airborne"  
   **Drone 2:** "Airborne"  
   **Drone 3:** "Airborne"

3. **Operator:** "Drone 1, follow me. Drone 2 and 3, patrol the perimeter."  
   **Drone 1:** "Following"  
   **Drone 2:** "Starting patrol, north sector"  
   **Drone 3:** "Starting patrol, south sector"

4. [Operator walks around, Drone 1 follows. Drones 2 and 3 patrol autonomously.]

5. **Drone 2:** "Movement detected, sector B"  
   **Operator:** "Drone 2, investigate and report"  
   **Drone 2:** "Investigating... false alarm, just a deer"

6. **Operator:** "All drones, return and land"  
   **Drones:** [all return to launch point, land]  
   **Drone 1:** "Landed, battery 42%"  
   **Drone 2:** "Landed, battery 38%"  
   **Drone 3:** "Landed, battery 45%"

**Key UX principles:**
- Voice is primary interface (hands free for RC stick if needed)
- Spatial audio (responses come from the drone in the air)
- Autonomous execution of clear commands
- Manual override available instantly (grab sticks)
- Proactive notifications (battery, detection events)

---

## Success Criteria

### Phase 1 (Simulation)
- [ ] Voice command arms/disarms simulated drone
- [ ] Voice command makes simulated drone take off / land
- [ ] Telemetry reads correctly (battery, GPS, altitude)

### Phase 2 (CV in Sim)
- [ ] MediaPipe detects person in synthetic video
- [ ] Control inputs calculated correctly to center person
- [ ] Simulated drone follows person smoothly

### Phase 3 (Multi-Drone Sim)
- [ ] 4 drones controlled independently in SITL
- [ ] Individual addressing works ("Drone 2, take off")
- [ ] Broadcast works ("All drones, land")
- [ ] Collision avoidance prevents simulated crashes

### Phase 4 (Hardware Prototype)
- [ ] Real drone arms/takes off/lands via voice
- [ ] FPV video captured on ground station
- [ ] Manual RC override instant (<50ms)
- [ ] Voice feedback audible from drone speaker

### Phase 5 (Real Follow-Me)
- [ ] Real drone tracks person outdoors
- [ ] Maintains 3-5m following distance
- [ ] Failsafes work (signal loss → RTL, battery low → land)

### Phase 6 (Multi-Drone Real)
- [ ] 2+ real drones controlled independently
- [ ] Formation flight maintained for 60+ seconds
- [ ] Collision avoidance prevents real crashes

### Phase 7 (Advanced Skills)
- [ ] 5+ skills documented and working
- [ ] Skills hot-swappable (no code recompile)
- [ ] Skills composable (can combine for complex behavior)

---

## Non-Goals (v1.0)

**Out of scope for first release:**
- Fully autonomous beyond-visual-line-of-sight (BVLOS) flight
- Racing/aerobatics (those stay manual, AI can assist but not control)
- Indoor navigation (outdoor-only for Phase 1-7)
- Object manipulation (no grippers, delivery mechanisms)
- Charging automation (manual battery swaps)

**Why:** Focus on core value proposition (voice-controlled coordination) before expanding scope.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Latency too high** (>200ms) for follow-me | High | Test in sim first, tune buffering, fall back to manual control |
| **Video quality insufficient** for CV | High | Use digital FPV (DJI O3/HDZero), not analog |
| **Collision avoidance false positives** | Medium | Conservative min distance (5m), manual override always available |
| **Bluetooth audio dropouts** | Low | Test range in open area, fall back to ground station speaker |
| **Skills conflict** (two skills want control) | Medium | Priority system (manual > safety > autonomous), skill orchestration layer |
| **Regulatory (FAA)** | High | Operate under Part 107 rules, maintain VLOS, <400ft AGL |

---

## Open Questions

1. **CRSF vs MAVLink:** Do we stick with CRSF for racing drones, or add MAVLink bridge for more features?
2. **Bluetooth range:** Will 50-100m range be sufficient, or do we need analog audio TX?
3. **Video multiplexing:** How do we handle 4x 1080p streams on one laptop? (USB bandwidth)
4. **Gesture priority:** If voice and gesture commands conflict, which wins?
5. **Battery management:** How does ground station track battery and force-land low drones?

**Resolution path:** Build Phase 1-2 (simulation), answers will emerge from testing.

---

## Next Steps

- [x] Create repo
- [x] Write PRD
- [ ] Set up dev environment (ArduPilot SITL, MAVSDK, OpenClaw)
- [ ] Implement Phase 1: Single drone in simulation
- [ ] Document simulation setup in README.md

---

**This is an architecture brainstorm, not a commitment. Expect this PRD to evolve as we learn.**
