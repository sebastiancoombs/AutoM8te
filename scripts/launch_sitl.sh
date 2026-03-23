#!/bin/bash
# AutoM8te Multi-Drone SITL Launcher
# Each instance gets its own sim_vehicle.py process with isolated working dir
# Ports: Instance 0 → tcp:5760, Instance 1 → tcp:5770, etc.

set -e

NUM_DRONES="${1:-5}"
ARDUPILOT_PATH="${ARDUPILOT_PATH:-$HOME/ardupilot}"
HOME_LAT=-35.363261
HOME_LON=149.165230
HOME_ALT=584
HOME_HDG=353
SPACING=0.00003  # ~3m between drones

if [ ! -f "$ARDUPILOT_PATH/Tools/autotest/sim_vehicle.py" ]; then
    echo "❌ ArduPilot not found at $ARDUPILOT_PATH"
    exit 1
fi

echo "🚁 AutoM8te SITL Launcher — $NUM_DRONES drones"
echo "================================================"

PIDS=()
TMPDIR_BASE=$(mktemp -d /tmp/autom8te_sitl.XXXXX)
echo "Working dir: $TMPDIR_BASE"

cleanup() {
    echo ""
    echo "🛑 Shutting down all SITL instances..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    # Kill any stray arducopter processes we spawned
    pkill -f "arducopter.*$TMPDIR_BASE" 2>/dev/null || true
    rm -rf "$TMPDIR_BASE"
    echo "✅ Cleaned up"
    exit 0
}
trap cleanup INT TERM

for i in $(seq 0 $((NUM_DRONES - 1))); do
    PORT=$((5760 + i * 10))
    LON=$(python3 -c "print(f'{$HOME_LON + $i * $SPACING:.6f}')")
    INSTANCE_DIR="$TMPDIR_BASE/drone_$i"
    mkdir -p "$INSTANCE_DIR"

    echo "  Drone $((i+1)): Instance $i | Port $PORT | Home ($HOME_LAT, $LON)"

    cd "$INSTANCE_DIR"
    python3 "$ARDUPILOT_PATH/Tools/autotest/sim_vehicle.py" \
        -v ArduCopter \
        -I "$i" \
        --no-mavproxy \
        --speedup 1 \
        -L "$HOME_LAT,$LON,$HOME_ALT,$HOME_HDG" \
        > "$INSTANCE_DIR/sitl.log" 2>&1 &
    PIDS+=($!)

    # Stagger launches to avoid port conflicts
    sleep 8
done

echo ""
echo "================================================"
echo "✅ All $NUM_DRONES SITL instances launched!"
echo ""
echo "TCP ports:"
for i in $(seq 0 $((NUM_DRONES - 1))); do
    PORT=$((5760 + i * 10))
    echo "  drone_$((i+1)) → tcp:127.0.0.1:$PORT"
done
echo ""
echo "Register with Swarm Manager:"
for i in $(seq 1 "$NUM_DRONES"); do
    PORT=$((5750 + i * 10))
    echo "  curl -X POST http://localhost:8000/tools/drone_register -H 'Content-Type: application/json' -d '{\"drone_id\":\"drone_$i\",\"connection_string\":\"tcp:127.0.0.1:$PORT\"}'"
done
echo ""
echo "Press Ctrl+C to stop all instances"

# Wait for all
wait
