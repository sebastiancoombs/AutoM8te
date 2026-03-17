# AutoM8te Setup Guide

**Phase 1: SITL + Swarm Manager + Basic Control**

This guide walks through setting up the development environment for AutoM8te Phase 1.

---

## Prerequisites

- **Operating System:** Ubuntu 20.04+ or macOS (Linux recommended)
- **Python:** 3.9+
- **Node.js:** 16+ (for OpenClaw)
- **Git:** For cloning repositories
- **Build tools:** gcc, g++, make, cmake

---

## Step 1: Install ArduPilot SITL

ArduPilot SITL (Software In The Loop) is the flight controller simulation.

### On Ubuntu/Linux:

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install git python3-pip python3-dev python3-opencv \
    python3-wxgtk4.0 python3-matplotlib python3-lxml libxml2-dev \
    libxslt1-dev

# Clone ArduPilot
cd ~
git clone https://github.com/ArduPilot/ardupilot.git
cd ardupilot
git submodule update --init --recursive

# Install MAVProxy (required for SITL)
pip3 install --user pymavlink MAVProxy

# Build ArduCopter SITL
cd ~/ardupilot/ArduCopter
../Tools/autotest/sim_vehicle.py -w
```

### On macOS:

```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install python wxpython opencv

# Clone ArduPilot
cd ~
git clone https://github.com/ArduPilot/ardupilot.git
cd ardupilot
git submodule update --init --recursive

# Install MAVProxy
pip3 install --user pymavlink MAVProxy

# Build ArduCopter SITL
cd ~/ardupilot/ArduCopter
../Tools/autotest/sim_vehicle.py -w
```

**Verification:**
```bash
cd ~/ardupilot/ArduCopter
sim_vehicle.py -v ArduCopter -L Canberra --console --map
```

You should see a MAVProxy console and map window open. Type `mode GUIDED` to verify it's working.

---

## Step 2: Install MAVSDK-Python

MAVSDK is the control library for communicating with ArduPilot.

```bash
pip3 install mavsdk
```

**Verification:**
```python
python3 -c "import mavsdk; print('MAVSDK version:', mavsdk.__version__)"
```

---

## Step 3: Set Up AutoM8te Swarm Manager

Navigate to the AutoM8te repo and install dependencies:

```bash
cd AutoM8te

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**Verification:**
```bash
python -c "import fastapi; import mavsdk; print('Dependencies OK')"
```

---

## Step 4: Test Single Drone Setup

### Terminal 1: Launch SITL

```bash
export ARDUPILOT_PATH=~/ardupilot
./scripts/launch_sitl.sh
```

This launches 4 SITL instances (ports 14550, 14560, 14570, 14580). For now, we'll only use the first one.

### Terminal 2: Start Swarm Manager

```bash
./scripts/start_swarm_manager.sh
```

The FastAPI server will start on `http://localhost:8000`.

### Terminal 3: Test Commands

```bash
./scripts/test_single_drone.sh
```

This script:
1. Registers `drone_1` with the Swarm Manager
2. Queries telemetry
3. Commands takeoff to 5m
4. Queries telemetry again

**Expected output:** The drone should arm and take off in the SITL console/map.

---

## Step 5: Manual Testing via API

You can also interact with the Swarm Manager directly:

### Register Drone:
```bash
curl -X POST http://localhost:8000/tools/drone_register \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1", "connection_string": "udp://:14550"}'
```

### Takeoff:
```bash
curl -X POST http://localhost:8000/tools/drone_takeoff \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1", "altitude_m": 5.0}'
```

### Move Forward 10m:
```bash
curl -X POST http://localhost:8000/tools/drone_move \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1", "north_m": 10.0, "east_m": 0.0, "down_m": -5.0, "yaw_deg": 0.0}'
```

### Land:
```bash
curl -X POST http://localhost:8000/tools/drone_land \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1"}'
```

### Query Telemetry:
```bash
curl -X POST http://localhost:8000/tools/drone_query \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1"}'
```

---

## Step 6: Install AirSim (Deferred to Later)

AirSim + Unreal Engine 5 setup is more complex and will be tackled once SITL + MAVSDK control is validated.

For now, you can:
- Use MAVProxy's map view to visualize drone movement
- Test all commands via SITL console
- Validate MAVSDK control works correctly

**Phase 1 Goal:** Get voice commands working via OpenClaw → Swarm Manager → MAVSDK → SITL, with MAVProxy visualization.

---

## Step 7: OpenClaw Integration (Next)

Once SITL + Swarm Manager is working, we'll:
1. Configure OpenClaw MCP server pointing to `http://localhost:8000`
2. Load the `mcp_tools.json` definition
3. Test voice commands: "Drone 1, take off" → triggers `/tools/drone_takeoff`

**Reference:** See `openclaw_tools/mcp_tools.json` for MCP tool definitions.

---

## Troubleshooting

### SITL won't start:
- Check `ARDUPILOT_PATH` is correct
- Ensure ArduPilot submodules are initialized: `git submodule update --init --recursive`
- Try building manually: `cd ~/ardupilot/ArduCopter && ../Tools/autotest/sim_vehicle.py -w`

### MAVSDK connection timeout:
- Verify SITL is running: `nc -z localhost 14550` (should succeed)
- Check firewall isn't blocking UDP ports
- Try explicit connection string: `udp://127.0.0.1:14550`

### Swarm Manager crashes:
- Check Python dependencies: `pip install -r requirements.txt`
- Verify MAVSDK installed: `python -c "import mavsdk"`
- Check logs in terminal output

---

## Next Steps

Once single-drone control is validated:
- [ ] Test multi-drone registration (4 SITL instances)
- [ ] Test broadcast commands (all drones take off)
- [ ] Integrate with OpenClaw voice control
- [ ] Add AirSim visualization (Phase 2)
- [ ] Integrate YOLO object detection (Phase 2)

**Current Status:** ✅ Project structure created, Swarm Manager implemented, scripts ready.  
**Next Milestone:** First successful voice-controlled takeoff via OpenClaw → Swarm Manager → SITL.
