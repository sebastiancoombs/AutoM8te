# AutoM8te - Product Requirements Document

**Version:** 0.3  
**Date:** March 12, 2026  
**Status:** Architecture Finalized  
**Scope:** Simulation validation only — hardware implementation deferred to future phase

---

## Vision

**Build and validate a voice-controlled AI drone swarm system in simulation where one human operator coordinates multiple drones through natural language commands and computer vision.**

Core principles:
- **One brain, multiple bodies** — All intelligence lives on ground station, drones are simulated actuators
- **Object-aware intelligence** — Track and follow any object (people, cars, animals) via YOLO + CV
- **Skills-based flexibility** — New capabilities added as OpenClaw skills, not hardcoded features
- **Hardware-in-the-loop ready** — Control via MAVSDK → ArduPilot SITL (identical interface for real hardware)
- **Prove in simulation first** — Validate all behaviors before considering hardware

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
┌─────────────────────────────────────────────────────┐
│          OpenClaw Ground Station                    │
│  - Voice I/O (STT/TTS via ElevenLabs)               │
│  - Intent recognition (LLM)                         │
│  - Skills orchestration                             │
│  - Video analysis (YOLO pipeline)                   │
└────────────────────┬────────────────────────────────┘
                     │ (MCP Server interface)
                     ↓
┌─────────────────────────────────────────────────────┐
│         Swarm Manager (Python/FastAPI)              │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Drone Registry                                │ │
│  │  - drone_1: MAVSDK conn, position, task       │ │
│  │  - drone_2: MAVSDK conn, position, task       │ │
│  │  - drone_3, drone_4: ...                      │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Command Router                                │ │
│  │  - Parse: "Drone 2, follow car"               │ │
│  │  - Route to MAVSDK connection                 │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Object Tracker (YOLO + DeepSORT)              │ │
│  │  - Detect objects from AirSim feeds           │ │
│  │  - Maintain IDs across frames                 │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │ Collision Avoidance                           │ │
│  │  - Track all drone positions                  │ │
│  │  - Override commands if risk detected         │ │
│  └───────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────┘
                     │ (MAVSDK-Python)
                     ↓
┌─────────────────────────────────────────────────────┐
│     ArduPilot SITL Instances (Flight Controllers)   │
│                                                     │
│  SITL-1 (UDP 14550) ← Drone 1 MAVLink commands     │
│  SITL-2 (UDP 14560) ← Drone 2 MAVLink commands     │
│  SITL-3 (UDP 14570) ← Drone 3 MAVLink commands     │
│  SITL-4 (UDP 14580) ← Drone 4 MAVLink commands     │
│                                                     │
│  (Computes flight physics, sensors, state)          │
└────────────────────┬────────────────────────────────┘
                     │ (MAVLink telemetry)
                     ↓
┌─────────────────────────────────────────────────────┐
│          AirSim (Unreal Engine 5)                   │
│  - Reads SITL state via MAVLink                     │
│  - Renders drone positions in 3D                    │
│  - Provides camera feeds → YOLO                     │
│  - Spawns objects (cars, people, obstacles)         │
└─────────────────────────────────────────────────────┘
```

### Design Decision: MAVSDK → SITL → AirSim

**Why this architecture?**
- **MAVSDK-Python** = Same API for sim and real hardware (zero code changes)
- **ArduPilot SITL** = Real flight controller code (identical to Cube/Pixhawk firmware)
- **AirSim** = Visualization only (physics computed by SITL, not AirSim)
- **Hardware-ready:** Swap SITL for real flight controller → instant hardware migration

**Control flow:**
1. OpenClaw intent → Swarm Manager (MCP tools)
2. Swarm Manager → MAVSDK-Python → MAVLink commands
3. ArduPilot SITL → Computes flight physics
4. AirSim → Reads SITL telemetry, renders scene
5. AirSim camera feeds → YOLO → Object detections → Swarm Manager

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
- ✅ MAVLink support (connects to ArduPilot SITL)
- ✅ Supports object spawning (cars, people, obstacles)
- ✅ Multi-drone support out of the box

**Hardware deferred:** Once simulation validates all behaviors, hardware becomes a mechanical engineering problem (not a software risk).

---

## Technical Stack

### Ground Station
| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Orchestration** | OpenClaw | Skills-based, LLM integration, proven runtime |
| **Swarm Manager** | FastAPI + Python | Async-friendly, MCP server interface |
| **Drone Control** | MAVSDK-Python | Industry standard, identical API for sim/real hardware |
| **MCP Interface** | Custom MCP Server | Exposes tools to OpenClaw (takeoff, move, query, etc.) |
| **Object Detection** | YOLOv8 | Fast, accurate, multi-class detection (people, cars, animals) |
| **Object Tracking** | DeepSORT | Appearance-based tracking, maintains IDs across frames |
| **Computer Vision** | MediaPipe | Pose + gesture detection (supplementary to YOLO) |
| **Voice I/O** | ElevenLabs API | High quality STT/TTS, low latency |
| **Video Processing** | OpenCV | Frame capture, pre-processing for YOLO |

### Simulation Environment
- **ArduPilot SITL** — Flight controller simulation (one instance per drone)
- **AirSim** — Unreal Engine-based 3D renderer + camera feeds
- **Unreal Engine 5** — Photorealistic rendering for CV
- **MAVLink** — Communication protocol (SITL ↔ AirSim)

---

## Project Structure

```
AutoM8te/
├── swarm_manager/
│   ├── __init__.py
│   ├── server.py          # FastAPI app (MCP server)
│   ├── drone_registry.py  # Drone state tracking (MAVSDK connections)
│   ├── command_router.py  # Intent → MAVSDK commands
│   ├── collision.py       # Collision avoidance logic
│   ├── object_tracker.py  # YOLO + DeepSORT pipeline
│   └── mavsdk_wrapper.py  # MAVSDK connection pool
├── openclaw_tools/
│   ├── mcp_server.py      # MCP server for OpenClaw
│   └── tools.json         # Tool definitions
├── config/
│   ├── sitl_config.yaml   # SITL instances (ports, IDs)
│   └── airsim_settings.json  # AirSim multi-drone config
├── skills/
│   ├── follow_object/     # OpenClaw skill: follow detected object
│   ├── patrol_route/      # OpenClaw skill: waypoint navigation
│   ├── formation_flight/  # OpenClaw skill: multi-drone formation
│   └── search_pattern/    # OpenClaw skill: area coverage
├── scripts/
│   ├── launch_sitl.sh     # Start all 4 SITL instances
│   ├── setup_airsim.sh    # Configure AirSim environment
│   └── test_yolo.py       # YOLO detection test script
├── tests/
│   └── ...                # Unit + integration tests
├── PRD.md                 # This document
└── README.md              # Setup instructions
```

---

## Core Components

### 1. Swarm Manager (Python FastAPI Service)

**Purpose:** Centralized drone coordination layer between OpenClaw and ArduPilot SITL.

**Drone Registry** (`drone_registry.py`):
```python
from dataclasses import dataclass
from mavsdk import System

@dataclass
class DroneState:
    id: str                      # drone_1, drone_2, etc.
    mavsdk: System               # MAVSDK connection
    position: tuple              # (north, east, down) in meters
    orientation: tuple           # (roll, pitch, yaw) in degrees
    tracking_object_id: str | None  # Object being tracked
    collision_risk: bool         # Collision avoidance flag

class DroneRegistry:
    def __init__(self):
        self.drones = {}  # id → DroneState
    
    async def register(self, drone_id: str, port: int):
        """Connect to SITL instance via MAVSDK"""
        drone = System()
        await drone.connect(system_address=f"udp://:{port}")
        self.drones[drone_id] = DroneState(...)
    
    async def update_telemetry(self, drone_id: str):
        """Fetch latest position/orientation from SITL"""
        # Read telemetry via MAVSDK
```

**Command Router** (`command_router.py`):
```python
class CommandRouter:
    def __init__(self, registry: DroneRegistry):
        self.registry = registry
    
    async def takeoff(self, drone_id: str, altitude_m: float = 5.0):
        """Send takeoff command to SITL via MAVSDK"""
        drone = self.registry.drones[drone_id]
        await drone.mavsdk.action.set_takeoff_altitude(altitude_m)
        await drone.mavsdk.action.arm()
        await drone.mavsdk.action.takeoff()
    
    async def move(self, drone_id: str, north: float, east: float, down: float, yaw: float = 0):
        """Move drone to NED coordinates"""
        drone = self.registry.drones[drone_id]
        await drone.mavsdk.action.goto_location(north, east, down, yaw)
    
    async def velocity(self, drone_id: str, vx: float, vy: float, vz: float, yaw_rate: float = 0):
        """Set velocity vector"""
        drone = self.registry.drones[drone_id]
        await drone.mavsdk.offboard.set_velocity_ned(vx, vy, vz, yaw_rate)
    
    async def broadcast(self, command: str):
        """Send command to all drones (takeoff, land, return_home)"""
        for drone_id in self.registry.drones:
            await getattr(self, command)(drone_id)
```

**Collision Avoidance** (`collision.py`):
- Tracks positions of all active drones
- Predicts movement paths (velocity vectors)
- Overrides commands if collision risk detected (5m minimum separation)
- Logs all overrides for analysis

**Object Tracker** (`object_tracker.py`):
- Runs YOLOv8 on AirSim camera feeds
- Maintains object registry (ID, class, bounding box, position, velocity)
- Uses DeepSORT for appearance-based tracking (maintains IDs across occlusion)
- Associates OpenClaw intent with YOLO detections

---

### 2. OpenClaw Integration (MCP Server)

**MCP Tools Exposed to OpenClaw:**

```json
{
  "tools": [
    {
      "name": "drone_takeoff",
      "description": "Make drone take off to specified altitude",
      "parameters": {
        "drone_id": "string (drone_1, drone_2, drone_3, drone_4)",
        "altitude_m": "number (default: 5.0)"
      }
    },
    {
      "name": "drone_land",
      "description": "Land drone at current position",
      "parameters": {
        "drone_id": "string"
      }
    },
    {
      "name": "drone_move",
      "description": "Move drone to NED coordinates (North-East-Down)",
      "parameters": {
        "drone_id": "string",
        "north_m": "number (meters north of home)",
        "east_m": "number (meters east of home)",
        "down_m": "number (negative = altitude, e.g., -10 = 10m altitude)",
        "yaw_deg": "number (optional, 0-360)"
      }
    },
    {
      "name": "drone_velocity",
      "description": "Set drone velocity vector",
      "parameters": {
        "drone_id": "string",
        "vx_ms": "number (north velocity in m/s)",
        "vy_ms": "number (east velocity in m/s)",
        "vz_ms": "number (down velocity in m/s, negative = climb)",
        "yaw_rate_degs": "number (optional, degrees/second)"
      }
    },
    {
      "name": "drone_query",
      "description": "Get drone telemetry (position, orientation, battery, etc.)",
      "parameters": {
        "drone_id": "string"
      }
    },
    {
      "name": "detect_objects",
      "description": "Run YOLO detection on drone camera feed",
      "parameters": {
        "drone_id": "string",
        "classes": "array (optional: ['car', 'person', 'dog'], defaults to all 80 YOLO classes)"
      }
    },
    {
      "name": "track_object",
      "description": "Follow detected object with drone",
      "parameters": {
        "drone_id": "string",
        "object_id": "string (from detect_objects)",
        "follow_distance_m": "number (default: 8.0)",
        "follow_mode": "string (behind | above | orbit)"
      }
    },
    {
      "name": "drone_broadcast",
      "description": "Send command to all drones",
      "parameters": {
        "command": "string (takeoff | land | return_home)"
      }
    }
  ]
}
```

**MCP Server Implementation** (`openclaw_tools/mcp_server.py`):
```python
from fastapi import FastAPI
from swarm_manager.drone_registry import DroneRegistry
from swarm_manager.command_router import CommandRouter

app = FastAPI()
registry = DroneRegistry()
router = CommandRouter(registry)

@app.post("/tools/drone_takeoff")
async def drone_takeoff(drone_id: str, altitude_m: float = 5.0):
    await router.takeoff(drone_id, altitude_m)
    return {"status": "success", "message": f"{drone_id} taking off to {altitude_m}m"}

@app.post("/tools/drone_query")
async def drone_query(drone_id: str):
    await registry.update_telemetry(drone_id)
    drone = registry.drones[drone_id]
    return {
        "drone_id": drone_id,
        "position": {"north": drone.position[0], "east": drone.position[1], "down": drone.position[2]},
        "orientation": {"roll": drone.orientation[0], "pitch": drone.orientation[1], "yaw": drone.orientation[2]},
        "tracking": drone.tracking_object_id
    }

# ... (other tool endpoints)
```

**OpenClaw MCP Skill Configuration:**
```json
{
  "name": "autom8te-swarm",
  "server": "http://localhost:8000",
  "tools": [
    "drone_takeoff", "drone_land", "drone_move", "drone_velocity",
    "drone_query", "detect_objects", "track_object", "drone_broadcast"
  ]
}
```

---

### 3. Computer Vision Pipeline

**Input:** AirSim camera feeds (RGB images, 30+ fps, 1080p)  
**Processing Pipeline:**
1. **YOLO v8** — Object detection (80+ classes: person, car, truck, dog, etc.)
2. **DeepSORT** — Appearance-based tracking (maintains object IDs across frames)
3. **MediaPipe** (optional) — Pose/gesture for human interaction
4. **Spatial Positioning** — Estimate 3D position from bounding box + camera intrinsics

**Output:** List of detected objects with:
- Class (car, person, dog, etc.)
- Bounding box (pixel coords)
- Confidence score
- Tracking ID (persistent across frames)
- Estimated 3D position (relative to drone)

**Object Selection Logic (Conversational Disambiguation):**

When user says **"Follow that car"** and YOLO detects 5 cars:

1. **Swarm Manager** returns list of detected cars to OpenClaw:
   ```json
   [
     {"id": "car_1", "class": "car", "color": "red", "position": "10 o'clock"},
     {"id": "car_2", "class": "car", "color": "blue", "position": "2 o'clock"},
     {"id": "car_3", "class": "car", "color": "white", "position": "12 o'clock"}
   ]
   ```

2. **OpenClaw (voice):** *"I see 3 cars — a red sedan at 10 o'clock, blue truck at 2 o'clock, white SUV straight ahead. Which one?"*

3. **User:** "The red sedan"

4. **OpenClaw** → Calls `track_object(drone_id="drone_1", object_id="car_1")`

5. **Swarm Manager** → Locks onto `car_1`, begins following

**Fallback logic:**
- If only 1 object of specified class → Auto-select (no ambiguity)
- If user says "closest" → Pick nearest by distance
- If user says "front" / "left" / "right" → Spatial reasoning

---

### 4. Voice Interface

**Input:** Ground station mic → ElevenLabs STT  
**Processing:** OpenClaw LLM parses intent, routes to MCP tool  
**Output:** TTS audio → ground station speakers (for simulation)

**Addressing modes:**
- **"Drone 2, follow that car"** → Targets specific drone
- **"All drones, return home"** → Broadcasts to all
- **"Scout team, patrol north"** → Group addressing (Drones 1-3)

**Feedback loop:**
- User command → OpenClaw processes → MCP tool call → MAVSDK → SITL
- Response format: "[Drone 2]: Following red sedan, 8 meters behind"
- Console logging for debugging, audio feedback for natural interaction

---

## Development Phases

### Phase 0: Repository Setup ✅
- [x] Create GitHub repo
- [x] Write PRD (this document)
- [x] Define architecture
- [x] Choose tech stack

### Phase 1: SITL + AirSim + Basic Control (Week 1-2)
**Goal:** Single drone responds to voice commands via MAVSDK → SITL → AirSim.

**Tasks:**
- Install ArduPilot SITL (one instance, UDP 14550)
- Install MAVSDK-Python
- Install AirSim + Unreal Engine 5
- Configure AirSim to connect to SITL via MAVLink
- Build minimal Swarm Manager (FastAPI server with 3 tools: takeoff, move, land)
- Configure OpenClaw MCP skill pointing to Swarm Manager
- Voice command: "Take off" → drone takes off in AirSim
- Voice command: "Move forward 10 meters" → drone moves
- Voice command: "Land" → drone lands
- Verify telemetry reads correctly (position, orientation)

**Success criteria:**
- [ ] SITL instance runs and accepts MAVSDK commands
- [ ] AirSim renders drone position from SITL telemetry
- [ ] OpenClaw routes voice commands → MCP tools → MAVSDK → SITL
- [ ] Drone responds correctly in AirSim (takeoff, move, land)
- [ ] Telemetry visible in logs
- [ ] Camera feed accessible from AirSim

**Performance benchmark:** Test with 1 drone, then 2, then 4 (measure FPS, identify bottlenecks early).

### Phase 2: YOLO Object Detection (Week 3-4)
**Goal:** Drone detects and identifies objects in AirSim environment.

**Tasks:**
- Integrate YOLOv8 with AirSim camera feed
- Spawn objects in AirSim (cars, people, obstacles)
- Test detection: verify YOLO correctly identifies spawned objects
- Implement DeepSORT object tracking (maintain ID across frames)
- Display bounding boxes + labels in debug view
- Add `detect_objects` MCP tool
- Test conversational disambiguation: "Follow that car" with 5 cars visible

**Success criteria:**
- [ ] YOLO detects cars, people, obstacles in AirSim renders (>90% accuracy)
- [ ] Detection runs at 20+ fps (real-time)
- [ ] Object IDs persist across frames (DeepSORT tracking works)
- [ ] False positive rate <10%
- [ ] OpenClaw can query detected objects and disambiguate via voice

### Phase 3: Follow-Object Behavior (Week 5-6)
**Goal:** Drone tracks and follows detected objects via voice command.

**Tasks:**
- Voice command: "Follow that car" → OpenClaw disambiguates, drone locks on
- Implement PID control: keep object centered in frame
- Maintain safe distance (5-10m behind object)
- Handle object loss (car drives behind building → drone hovers, waits)
- Test with moving vehicles in AirSim
- Add `track_object` MCP tool

**Success criteria:**
- [ ] Drone locks onto specified object (car, person, etc.)
- [ ] Maintains follow distance without oscillation (<1m position error)
- [ ] Recovers when object temporarily occluded
- [ ] Voice command switches targets: "Follow that person instead"

### Phase 4: Multi-Drone Coordination (Week 7-8)
**Goal:** Control 4 drones independently in same AirSim environment.

**Tasks:**
- Launch 4 SITL instances (UDP 14550, 14560, 14570, 14580)
- Configure AirSim for 4 drones (settings.json)
- Implement Drone Registry (track state of each)
- Test individual addressing: "Drone 2, follow that car"
- Test broadcast: "All drones, land"
- Implement collision avoidance (5m minimum separation)
- Test: send two drones toward same target, verify avoidance

**Success criteria:**
- [ ] All 4 drones controllable independently via MAVSDK
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
1. Launch 3 SITL instances (ArduPilot)
2. Start AirSim with urban environment
3. Start Swarm Manager (FastAPI server)
4. Start OpenClaw ground station
5. Spawn traffic in AirSim (cars, pedestrians)

**Mission:**
1. **Operator:** "All drones, take off"  
   **System:** [All 3 drones lift to 5m hover in AirSim]  
   **Feedback:** "All drones airborne"

2. **Operator:** "Drone 1, follow that red car"  
   **System:** [YOLO detects 5 cars]  
   **OpenClaw:** "I see 5 cars — red sedan at 10 o'clock, blue truck at 2 o'clock, white SUV straight ahead, gray van at 4 o'clock, black coupe at 8 o'clock. Which one?"  
   **Operator:** "The red sedan"  
   **System:** [Drone 1 locks on via MAVSDK]  
   **Drone 1:** "Following red sedan, maintaining 8 meters"

3. **Operator:** "Drone 2, circle around that person"  
   **System:** [YOLO + MediaPipe detect person, Drone 2 begins orbit]  
   **Drone 2:** "Orbiting target, 10 meter radius"

4. **Operator:** "Drone 3, patrol between waypoints Alpha and Bravo"  
   **System:** [Drone 3 flies predetermined route via MAVSDK]  
   **Drone 3:** "Patrol active"

5. [Red car turns corner, drives behind building]  
   **Drone 1:** "Target occluded, holding position"  
   [Car emerges 5 seconds later, DeepSORT re-identifies]  
   **Drone 1:** "Target reacquired, resuming follow"

6. **Operator:** "Drone 1, switch to that blue truck instead"  
   **System:** [YOLO re-targets, Drone 1 switches via MAVSDK]  
   **Drone 1:** "Now following blue pickup truck"

7. **Operator:** "All drones, land at home position"  
   **System:** [All drones return to launch coordinates via MAVSDK, land sequentially]  
   **Feedback:** "All drones landed"

**Key UX principles:**
- Voice is primary interface
- Conversational disambiguation for ambiguous targets
- Autonomous tracking with proactive status updates
- Graceful handling of edge cases (occlusion, object loss)
- Multi-drone coordination without operator micromanagement

---

## Success Criteria (Simulation Only)

### Phase 1: SITL + AirSim + Basic Control
- [ ] SITL instance runs and accepts MAVSDK commands
- [ ] Voice command makes drone take off in AirSim (via MAVSDK → SITL)
- [ ] Voice command moves drone to specific coordinates
- [ ] Voice command lands drone
- [ ] Telemetry reads correctly (position, orientation)
- [ ] Camera feed accessible from AirSim
- [ ] Performance test: 4 drones in AirSim at 30+ fps

### Phase 2: YOLO Object Detection
- [ ] YOLO detects cars in AirSim environment (>90% accuracy)
- [ ] YOLO detects people in AirSim environment (>90% accuracy)
- [ ] Detection runs at 20+ fps (real-time)
- [ ] DeepSORT maintains object IDs across frames
- [ ] False positive rate <10%
- [ ] Conversational disambiguation works (5 cars → user specifies "red sedan")

### Phase 3: Follow-Object Behavior
- [ ] Voice: "Follow that car" → OpenClaw disambiguates, drone locks on
- [ ] Drone maintains 5-10m follow distance
- [ ] PID control prevents oscillation (<1m position error)
- [ ] Drone handles object occlusion (waits, resumes when reacquired)
- [ ] Voice: "Follow that person instead" → switches targets correctly

### Phase 4: Multi-Drone Coordination
- [ ] 4 SITL instances + 4 drones in AirSim (no collisions)
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
| **YOLO false positives** (detects non-existent objects) | High | Confidence threshold tuning, DeepSORT appearance validation |
| **SITL + AirSim performance** (low fps, stuttering) | High | Benchmark in Phase 1 (1/2/4 drones), reduce AirSim graphics quality if needed |
| **Object tracking loss** (ID switches between frames) | Medium | Use DeepSORT (appearance-based), not just IOU matching |
| **Collision avoidance false positives** | Medium | Conservative min distance (5m), log all overrides for analysis |
| **Skills conflict** (two skills want control) | Medium | Priority system (safety > autonomous > idle), skill orchestration layer |
| **MAVSDK API limitations** | Low | MAVSDK is mature, well-documented; fall back to direct MAVLink if needed |
| **Unreal Engine crashes** | Low | Save environment frequently, automate scene setup via scripts |

---

## Resolved Design Questions

1. **Swarm Manager architecture:** ✅ FastAPI + MAVSDK + MCP server
2. **Control flow:** ✅ OpenClaw → MAVSDK → ArduPilot SITL → AirSim (render only)
3. **Object selection ambiguity:** ✅ Conversational disambiguation via OpenClaw voice
4. **Skills coordination:** ✅ Priority system (safety > autonomous > idle) in Swarm Manager
5. **Object tracking:** ✅ DeepSORT (appearance-based, handles occlusion better than IOU)

## Open Questions

1. **YOLO model size:** YOLOv8 nano/small/medium/large? (Speed vs accuracy tradeoff — decide after Phase 1 performance test)
2. **Tracking persistence:** How long should drone remember an object after occlusion before giving up? (Test in Phase 3)
3. **Formation rigidity:** Fixed formation (diamond always) or dynamic (adapt to obstacles)? (Defer to Phase 5)

**Resolution path:** Build Phase 1-2, answers will emerge from testing. Document decisions as we go.

---

## Next Steps

- [x] Create repo
- [x] Write PRD (architecture finalized)
- [ ] Install ArduPilot SITL (one instance)
- [ ] Install MAVSDK-Python
- [ ] Install AirSim + Unreal Engine 5
- [ ] Configure AirSim → SITL connection (MAVLink)
- [ ] Build minimal Swarm Manager (3 tools: takeoff, move, land)
- [ ] Configure OpenClaw MCP skill
- [ ] Implement Phase 1: Single drone basic control
- [ ] Document SITL + AirSim setup in README.md

---

**This PRD is simulation-focused. Hardware implementation is a separate future phase.**  
**Expect this document to evolve as we learn from testing.**
