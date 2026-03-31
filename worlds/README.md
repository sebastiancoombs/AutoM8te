# AutoM8te Webots Worlds

## Quick Start

### Prerequisites
- **Webots R2025a** — `brew install --cask webots`
- **SUMO** (optional, for traffic) — `brew install sumo`
- **ArduPilot** dev environment (for SITL drone control)

### Running

1. Open Webots
2. **File → Open World** → select `worlds/autom8te_city.wbt`
3. Hit Play — you'll see:
   - A full city with roads, buildings, traffic signs
   - SUMO-driven cars moving through the streets
   - 4 pedestrians walking loops around city blocks
   - 4 drones spawned in a grid at the center (via Supervisor)

4. To connect drones to ArduPilot SITL:

```bash
# Terminal 1 — Drone 0
sim_vehicle.py -v ArduCopter --model webots-python -I0

# Terminal 2 — Drone 1  
sim_vehicle.py -v ArduCopter --model webots-python -I1

# ... one terminal per drone
```

### What's in the Scene

**From Webots built-in `city_traffic.wbt`:**
- Full road network with intersections, crossroads
- Hotels, towers, restaurants, residential buildings, museums
- Traffic lights, stop signs, speed limit signs
- SUMO traffic — BMWs, Citroens, Teslas, buses, trucks, scooters
- Forests, trees, pedestrian crossings

**Added by AutoM8te:**
- 4 pedestrians on walking loops (YOLO detection targets)
- Drone spawner — Supervisor that creates N drones at runtime

### Configuration

Edit the `drone_spawner` controllerArgs in `autom8te_city.wbt`:

| Arg | Default | Description |
|-----|---------|-------------|
| `--count` | 4 | Number of drones to spawn |
| `--spacing` | 5 | Meters between drones |
| `--altitude` | 0.5 | Spawn height above ground |
| `--center-x` | 0 | Grid center X coordinate |
| `--center-y` | 0 | Grid center Y coordinate |
| `--sitl-port-base` | 5760 | First SITL port (increments by 10) |
| `--camera-port-base` | 5600 | First camera stream port |

### Camera Streams

Each drone streams its downward-facing camera:
- Drone 0: port 5600
- Drone 1: port 5601
- Drone 2: port 5602
- Drone 3: port 5603

Use ArduPilot's `example_camera_receive.py` or our perception layer to consume frames.

### File Structure

```
worlds/
├── autom8te_city.wbt              # Main world file
├── autom8te_city_net/             # SUMO traffic network
│   ├── sumo.net.xml               # Road network
│   ├── sumo.rou.xml               # Vehicle routes
│   ├── sumo.sumocfg               # SUMO config
│   └── sumo.trip.xml              # Trip definitions
├── controllers/
│   └── drone_spawner/
│       └── drone_spawner.py       # Supervisor: spawns N drones
└── README.md
```

### Troubleshooting

- **SUMO not found**: Install with `brew install sumo`. Traffic still works without it (just no moving cars).
- **Drones not connecting**: Make sure each SITL instance uses a different `-I` index.
- **Pedestrians not walking**: The Pedestrian PROTO needs its controller. Check Webots console for errors.
- **Gatekeeper warning**: Webots R2025a may trigger macOS Gatekeeper. Right-click → Open to bypass.
