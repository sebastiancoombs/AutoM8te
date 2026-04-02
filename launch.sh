#!/bin/zsh
#
# AutoM8te Launch Script
#
# Starts N ArduPilot SITL instances, updates the Webots world file,
# launches Webots, and starts the intent layer.
#
# Usage:
#   ./launch.sh              # 4 drones (default)
#   ./launch.sh 8            # 8 drones
#   ./launch.sh 2 --no-webots  # 2 drones, headless (SITL + intent layer only)
#
# Prerequisites:
#   - ArduPilot built:  ~/ardupilot/build/sitl/bin/arducopter
#   - Webots installed: /Applications/Webots.app
#   - pymavlink:        pip3 install pymavlink
#   - Node.js:          for intent layer
#
# Stop: Ctrl+C (kills all child processes)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARDUPILOT_HOME="${ARDUPILOT_HOME:-$HOME/ardupilot}"
SIM_VEHICLE="$ARDUPILOT_HOME/Tools/autotest/sim_vehicle.py"
WEBOTS_BIN="/Applications/Webots.app/Contents/MacOS/webots"
WORLD_FILE="$SCRIPT_DIR/worlds/autom8te_city.wbt"
INTENT_LAYER="$SCRIPT_DIR/intent-layer"

DRONE_COUNT="${1:-4}"
EXTRA_ARGS="${2:-}"

SITL_BASE_PORT=5760       # ArduPilot SITL TCP port (instance 0)
MAVLINK_BASE_PORT=14550   # MAVLink UDP port for bridge
CAMERA_BASE_PORT=5600     # Webots camera stream ports

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Track child PIDs for cleanup
PIDS=()

cleanup() {
    echo -e "\n${YELLOW}Shutting down AutoM8te...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    # Kill any lingering SITL instances
    pkill -f "arducopter" 2>/dev/null || true
    pkill -f "sim_vehicle.py" 2>/dev/null || true
    echo -e "${GREEN}Clean shutdown.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ─── Preflight Checks ───────────────────────────────────────────────
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       AutoM8te Launch System         ║${NC}"
echo -e "${CYAN}║       Drones: ${DRONE_COUNT}                        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo

# Check ArduPilot
if [ ! -f "$ARDUPILOT_HOME/build/sitl/bin/arducopter" ]; then
    echo -e "${RED}✗ ArduPilot SITL not found at $ARDUPILOT_HOME${NC}"
    echo "  Build it:  cd ~/ardupilot && ./waf configure --board sitl && ./waf copter"
    exit 1
fi
echo -e "${GREEN}✓${NC} ArduPilot SITL found"

# Check Webots
if [ "$EXTRA_ARGS" != "--no-webots" ]; then
    if [ ! -f "$WEBOTS_BIN" ]; then
        echo -e "${RED}✗ Webots not found at $WEBOTS_BIN${NC}"
        echo "  Install: https://cyberbotics.com/doc/guide/installation-procedure"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Webots found"
fi

# Check pymavlink
if ! python3 -c "from pymavlink import mavutil" 2>/dev/null; then
    echo -e "${RED}✗ pymavlink not installed${NC}"
    echo "  Install: pip3 install pymavlink"
    exit 1
fi
echo -e "${GREEN}✓${NC} pymavlink installed"

# Check Node.js
if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js found"

echo

# ─── Step 1: Update World File ──────────────────────────────────────
echo -e "${CYAN}[1/4] Updating world file with $DRONE_COUNT drones...${NC}"
python3 "$SCRIPT_DIR/controllers/drone_spawner/add_drones.py" \
    --count "$DRONE_COUNT" \
    --spacing 5.0 \
    --center-x -45.0 \
    --center-y 45.0 \
    --camera-port-base "$CAMERA_BASE_PORT" \
    --world "$WORLD_FILE"
echo

# ─── Step 2: Start SITL Instances ───────────────────────────────────
echo -e "${CYAN}[2/4] Starting $DRONE_COUNT ArduPilot SITL instances...${NC}"

SITL_LOG_DIR="$SCRIPT_DIR/.sitl-logs"
mkdir -p "$SITL_LOG_DIR"

for i in $(seq 0 $((DRONE_COUNT - 1))); do
    INSTANCE_PORT=$((SITL_BASE_PORT + i * 10))
    echo -e "  Starting SITL instance $i (port $INSTANCE_PORT)..."

    # Start SITL directly (faster than sim_vehicle.py, no MAVProxy dependency)
    "$ARDUPILOT_HOME/build/sitl/bin/arducopter" \
        --model webots-python \
        --instance "$i" \
        --home "-35.363261,149.165230,584,353" \
        --defaults "$ARDUPILOT_HOME/Tools/autotest/default_params/copter.parm,$SCRIPT_DIR/config/sitl_params.parm" \
        > "$SITL_LOG_DIR/sitl_$i.log" 2>&1 &
    PIDS+=($!)
    echo -e "  ${GREEN}✓${NC} SITL $i started (PID ${PIDS[-1]})"
done

# Wait for SITLs to bind their ports
echo -e "  Waiting for SITL instances to initialize..."
sleep 5

# Verify SITL TCP ports are listening
echo -e "  Checking SITL ports..."
for i in $(seq 0 $((DRONE_COUNT - 1))); do
    INSTANCE_PORT=$((SITL_BASE_PORT + i * 10))
    RETRIES=10
    while ! lsof -i ":$INSTANCE_PORT" -sTCP:LISTEN >/dev/null 2>&1 && [ $RETRIES -gt 0 ]; do
        sleep 1
        RETRIES=$((RETRIES - 1))
    done
    if lsof -i ":$INSTANCE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} SITL $i listening on TCP $INSTANCE_PORT"
    else
        echo -e "  ${RED}✗${NC} SITL $i NOT listening on TCP $INSTANCE_PORT — check .sitl-logs/sitl_$i.log"
    fi
done

# Verify SITLs are running
RUNNING=0
for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
        RUNNING=$((RUNNING + 1))
    fi
done
echo -e "  ${GREEN}✓${NC} $RUNNING/$DRONE_COUNT SITL instances running"
echo

# ─── Step 3: Start Webots ───────────────────────────────────────────
if [ "$EXTRA_ARGS" != "--no-webots" ]; then
    echo -e "${CYAN}[3/4] Launching Webots...${NC}"
    "$WEBOTS_BIN" "$WORLD_FILE" &
    PIDS+=($!)
    echo -e "  ${GREEN}✓${NC} Webots launched (PID ${PIDS[-1]})"

    # Give Webots time to load the world and connect controllers
    echo -e "  Waiting for Webots to load world..."
    sleep 5
else
    echo -e "${YELLOW}[3/4] Skipping Webots (--no-webots)${NC}"
fi
echo

# ─── Step 4: Start DroneKit Server ──────────────────────────────────
echo -e "${CYAN}[4/4] Starting DroneKit server...${NC}"

# Wait for Webots to connect to SITL (controllers need to init first)
echo -e "  Waiting for SITL to be ready..."
sleep 10

DRONEKIT_PORT=$SITL_BASE_PORT  # SERIAL0: 5760 (Webots uses UDP 9002, not TCP)

# Use Python 3.10 venv if available (needed for pymavswarm)
if [ -f "$SCRIPT_DIR/venv310/bin/python" ]; then
    PYTHON="$SCRIPT_DIR/venv310/bin/python"
    echo -e "  Using Python 3.10 venv (pymavswarm enabled)"
else
    PYTHON="python3"
    echo -e "  Using system Python (pymavswarm may not be available)"
fi

"$PYTHON" "$SCRIPT_DIR/dronekit_server.py" \
    --count "$DRONE_COUNT" \
    --base-port "$DRONEKIT_PORT" \
    --port-step 10 \
    --http-port 8080 &
PIDS+=($!)
echo -e "  ${GREEN}✓${NC} DroneKit server starting on port 8080 (PID ${PIDS[-1]})"

echo
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       AutoM8te is running!           ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Drones:  $DRONE_COUNT                          ║${NC}"
echo -e "${GREEN}║  API:     http://localhost:8080      ║${NC}"
echo -e "${GREEN}║  Backend: DroneKit                   ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop everything     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo
echo -e "${CYAN}Quick test:${NC}"
echo "  curl -s http://localhost:8080/api/status | python3 -m json.tool"
echo
echo "  curl -s -X POST http://localhost:8080/api/takeoff \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"altitude\": 5}'"
echo

# Wait for any child to exit
wait
