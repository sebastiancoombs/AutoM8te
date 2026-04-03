# AutoM8te — Current State (Updated 2026-04-02)

## Infrastructure
- [x] GitHub repo: `sebastiancoombs/AutoM8te`
- [x] PRD written (simulation-scoped)
- [x] Daily build cron (10am Berlin, posts to #autom8te)
- [x] Launch script (`./launch.sh N`) — starts N SITL + Webots + server

## Simulation Environment
- [x] Webots R2025a city world — roads, buildings, cars, pedestrians, traffic
- [x] Iris drone proto with cameras (640x480, per-drone streaming ports)
- [x] Drone spawner — `add_drones.py` writes N drones into world file
- [x] ArduPilot SITL built and working (`--model webots-python`)
- [x] 4 drones spawn, connect to SITL, visible in Webots
- [x] Prearm checks disabled for sim (loop rate too slow with 4 SITL + Webots)

## Drone Control
- [x] DroneKit server (`dronekit_server.py`) — single Python file, Flask HTTP
- [x] Connects to N SITL instances with retry logic
- [x] API: `/api/status`, `/api/takeoff`, `/api/land`, `/api/goto`, `/api/hover`, `/api/rtl`, `/api/emergency`
- [x] **Drones arm and take off in Webots** (verified — drone_1 reached 3.4m)
- [ ] Goto/movement commands tested end-to-end in Webots

## Intent Layer (Node.js)
- [x] HTTP server with 9 tools (command, move, formation, search, follow, query, group, modifier)
- [x] Formation math — line, V, circle, ring, square, grid, diamond, echelon
- [x] Custom choreography — parametric, polar, bezier, circle, arc, line curves
- [x] Moving formations (orbit, figure-8, line motion paths)
- [x] Group management (assign, disband, list)
- [x] Custom modifiers (sinusoidal, pulse, sawtooth, etc.)
- [x] Mock adapter (works without SITL)
- [x] ArduPilot adapter + pymavlink bridge (built, connection issues mostly resolved)
- [ ] Intent layer wired to DroneKit server (still uses old bridge)

## Voice Control
- [x] OpenAI Realtime API integration — WebSocket, function calling, PCM audio
- [x] 9 tools registered and tested (371-791ms latency)
- [x] System prompt (military copilot style)
- [ ] Voice connected to live Webots simulation (tested against mock only)

## Computer Vision
- [x] YOLO bridge scaffold (`perception/yolo_bridge.py`)
- [x] Mock detector for testing
- [ ] YOLO actually running on drone camera feeds
- [ ] Object tracking (SORT/DeepSORT) across frames

## Interceptor Module
- [x] Target assignment — Hungarian algorithm (scipy), optimal 1:1 matching
- [x] Swarm comms — broadcast message bus, per-drone send/listen
- [x] Hybrid pursuit — predictive intercept + pure pursuit (APN removed, too conservative)
- [x] Realistic target simulation — acceleration-limited evasion (jink, circle, sprint, random)
- [x] Mission coordinator — full state machine (IDLE → PURSUING → INTERCEPTED)
- [x] Auto-reassignment on kill/loss
- [x] Test simulation — **3/4 kills in 6s** (25 m/s interceptors vs 15 m/s targets)
- [ ] Integrated with DroneKit server (needs `/api/intercept` endpoint)
- [ ] Running in Webots (enemy drones as additional SITL instances)

## Not Started
- [ ] pymavswarm integration (needs Python 3.10+, current system is 3.9)
- [ ] Search patterns running in simulation
- [ ] Follow-object with YOLO + pursuit
- [ ] Multi-drone formation flight verified in Webots
- [ ] Obstacle avoidance (rangefinders on Iris proto)
