#!/bin/bash
#
# AutoM8te SITL Launch — Pre-built ArduPilot stack
#
# Starts: Webots → waits for controllers → N SITL instances → DroneKit bridge
# All pre-built components, no custom flight controllers.
#
# Usage: ./launch_sitl.sh [drone_count]

set -euo pipefail

DRONE_COUNT="${1:-4}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARDUPILOT_HOME="${ARDUPILOT_HOME:-$HOME/ardupilot}"
WORLD_FILE="$SCRIPT_DIR/worlds/autom8te_city.wbt"
PARAMS_FILE="$SCRIPT_DIR/config/sitl_params.parm"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

PIDS=()
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    pkill -f arducopter 2>/dev/null || true
    pkill -f sim_vehicle 2>/dev/null || true
    exit 0
}
trap cleanup EXIT INT TERM

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AutoM8te — SITL Mode               ║${NC}"
echo -e "${CYAN}║   Drones: $DRONE_COUNT (ArduPilot + Webots physics) ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"

# ─── Step 1: Generate world ──────────────────────────────────────────
echo -e "${CYAN}[1/4] Generating world with $DRONE_COUNT drones (SITL mode)...${NC}"
python3 "$SCRIPT_DIR/controllers/drone_spawner/add_drones.py" \
    --count "$DRONE_COUNT" --mode sitl

# ─── Step 2: Launch Webots ───────────────────────────────────────────
echo -e "${CYAN}[2/4] Launching Webots...${NC}"
/Applications/Webots.app/Contents/MacOS/webots "$WORLD_FILE" &
PIDS+=($!)
echo "  Waiting 20s for Webots to load world..."
sleep 20

# ─── Step 3: Launch SITL instances ───────────────────────────────────
echo -e "${CYAN}[3/4] Starting $DRONE_COUNT ArduPilot SITL instances...${NC}"
for i in $(seq 0 $((DRONE_COUNT - 1))); do
    PORT=$((5760 + i * 10))
    echo "  Instance $i → TCP :$PORT, UDP :$((14550 + i * 10))"

    cd "$ARDUPILOT_HOME"
    python3 Tools/autotest/sim_vehicle.py \
        -v ArduCopter \
        --model webots-python \
        -I$i \
        --no-rebuild \
        --no-mavproxy \
        --add-param-file="$PARAMS_FILE" \
        > /tmp/sitl_instance_$i.log 2>&1 &
    PIDS+=($!)
    cd "$SCRIPT_DIR"

    # Stagger launches to avoid port conflicts
    sleep 3
done

echo "  Waiting 30s for SITL to initialize and connect to Webots..."
sleep 30

# ─── Step 4: Verify connections ──────────────────────────────────────
echo -e "${CYAN}[4/4] Verifying connections...${NC}"
ALL_OK=true
for i in $(seq 0 $((DRONE_COUNT - 1))); do
    PORT=$((5760 + i * 10))
    if timeout 2 bash -c "echo '' > /dev/tcp/127.0.0.1/$PORT" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} SITL instance $i on :$PORT"
    else
        echo -e "  ${YELLOW}✗${NC} SITL instance $i on :$PORT — not responding"
        ALL_OK=false
    fi
done

if [ "$ALL_OK" = true ]; then
    echo -e "\n${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   All $DRONE_COUNT drones connected!            ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║   Connect via DroneKit/pymavswarm:   ║${NC}"
    for i in $(seq 0 $((DRONE_COUNT - 1))); do
        PORT=$((5760 + i * 10))
        echo -e "${GREEN}║   drone_$i: tcp:127.0.0.1:$PORT      ║${NC}"
    done
    echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║   Or use MAVProxy:                   ║${NC}"
    echo -e "${GREEN}║   mavproxy.py --master=tcp:127.0.0.1:5760 ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
else
    echo -e "\n${YELLOW}Some instances didn't connect. Check /tmp/sitl_instance_*.log${NC}"
fi

echo -e "\n${CYAN}Press Ctrl+C to stop all.${NC}"
wait
