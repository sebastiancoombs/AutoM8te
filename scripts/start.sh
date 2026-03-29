#!/bin/bash
# AutoM8te — One-command startup
# Usage: ./scripts/start.sh [num_drones]
# Launches SITL, starts server, registers drones in a circle formation.

set -e

NUM_DRONES="${1:-4}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ARDUPILOT_PATH="${ARDUPILOT_PATH:-$HOME/ardupilot}"
SERVER_PORT=8000

# Circle center (Canberra default)
HOME_LAT=-35.363261
HOME_LON=149.165230
HOME_ALT=584
HOME_HDG=353
CIRCLE_RADIUS=0.00015  # ~15m radius

if [ ! -f "$ARDUPILOT_PATH/Tools/autotest/sim_vehicle.py" ]; then
    echo "❌ ArduPilot not found at $ARDUPILOT_PATH"
    echo "   Set ARDUPILOT_PATH or install to ~/ardupilot"
    exit 1
fi

if [ ! -d "$PROJECT_DIR/venv" ]; then
    echo "❌ Python venv not found at $PROJECT_DIR/venv"
    echo "   Run: cd $PROJECT_DIR && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

echo "🚁 AutoM8te — Starting $NUM_DRONES drones"
echo "================================================"

PIDS=()
TMPDIR_BASE=$(mktemp -d /tmp/autom8te_sitl.XXXXX)

cleanup() {
    echo ""
    echo "🛑 Shutting down everything..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    pkill -f "arducopter.*$TMPDIR_BASE" 2>/dev/null || true
    pkill -f "swarm_manager.server" 2>/dev/null || true
    rm -rf "$TMPDIR_BASE"
    echo "✅ All stopped"
    exit 0
}
trap cleanup INT TERM

# ── Step 1: Launch SITL instances in a circle ──
echo ""
echo "📡 Launching $NUM_DRONES SITL instances (circle formation)..."

for i in $(seq 0 $((NUM_DRONES - 1))); do
    PORT=$((5760 + i * 10))
    ANGLE=$(python3 -c "import math; print(2 * math.pi * $i / $NUM_DRONES)")
    LAT=$(python3 -c "import math; print(f'{$HOME_LAT + $CIRCLE_RADIUS * math.cos($ANGLE):.6f}')")
    LON=$(python3 -c "import math; print(f'{$HOME_LON + $CIRCLE_RADIUS * math.sin($ANGLE):.6f}')")

    INSTANCE_DIR="$TMPDIR_BASE/drone_$i"
    mkdir -p "$INSTANCE_DIR"

    echo "  drone_$((i+1)): port $PORT | ($LAT, $LON)"

    cd "$ARDUPILOT_PATH/ArduCopter"
    python3 "$ARDUPILOT_PATH/Tools/autotest/sim_vehicle.py" \
        -v ArduCopter \
        -I "$i" \
        --no-mavproxy \
        --no-rebuild \
        --speedup 1 \
        --custom-location="$LAT,$LON,$HOME_ALT,$HOME_HDG" \
        > "$INSTANCE_DIR/sitl.log" 2>&1 &
    PIDS+=($!)
    sleep 8
done

echo "✅ All SITL instances launched"

# ── Step 2: Start the server ──
echo ""
echo "🖥️  Starting AutoM8te server..."
cd "$PROJECT_DIR"
source venv/bin/activate
python -m swarm_manager.server > "$TMPDIR_BASE/server.log" 2>&1 &
PIDS+=($!)
SERVER_PID=$!

# Wait for server to be ready
echo -n "  Waiting for server"
for attempt in $(seq 1 30); do
    if curl -s "http://localhost:$SERVER_PORT/api/status" > /dev/null 2>&1; then
        echo " ✅"
        break
    fi
    echo -n "."
    sleep 1
    if [ "$attempt" -eq 30 ]; then
        echo " ❌ Server didn't start. Check $TMPDIR_BASE/server.log"
        cleanup
    fi
done

# ── Step 3: Register all drones ──
echo ""
echo "🔗 Registering $NUM_DRONES drones..."

for i in $(seq 1 "$NUM_DRONES"); do
    PORT=$((5750 + i * 10))
    RESULT=$(curl -s -X POST "http://localhost:$SERVER_PORT/tools/drone_register" \
        -H 'Content-Type: application/json' \
        -d "{\"drone_id\":\"drone_$i\",\"connection_string\":\"tcp:127.0.0.1:$PORT\"}" 2>&1)
    STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "error")
    echo "  drone_$i → tcp:127.0.0.1:$PORT [$STATUS]"
done

# ── Done ──
echo ""
echo "================================================"
echo "🚁 AutoM8te is running!"
echo ""
echo "  Server:    http://localhost:$SERVER_PORT"
echo "  Tracker:   http://localhost:$SERVER_PORT/tracker"
echo "  3D View:   http://localhost:$SERVER_PORT/tracker3d"
echo "  Status:    http://localhost:$SERVER_PORT/api/status"
echo "  Drones:    $NUM_DRONES (circle formation)"
echo "  Logs:      $TMPDIR_BASE/"
echo ""
echo "Press Ctrl+C to stop everything"

wait
