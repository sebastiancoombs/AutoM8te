#!/bin/bash
# Launch multiple ArduPilot SITL instances for multi-drone testing.
#
# Usage:
#   ./scripts/launch_sitl.sh [NUM_INSTANCES]
#   Default: 2 instances
#
# Each instance gets:
#   - Unique instance ID (-I flag)
#   - TCP port: 5760 + (instance * 10)
#   - Home position offset: 50m east per instance
#
# Stop all: pkill -f arducopter

set -e

ARDUPILOT_DIR="${ARDUPILOT_DIR:-$HOME/ardupilot}"
NUM_INSTANCES="${1:-2}"
SPEEDUP="${SITL_SPEEDUP:-10}"

# Base home location: Canberra, Australia (ArduPilot default)
HOME_LAT="-35.363261"
HOME_LON="149.165230"
HOME_ALT="584"
HOME_HDG="353"

# Spacing between drones (meters east)
SPACING_M=50

echo "🚁 AutoM8te SITL Launcher"
echo "  Instances: $NUM_INSTANCES"
echo "  Speedup: ${SPEEDUP}x"
echo "  ArduPilot: $ARDUPILOT_DIR"
echo ""

# Kill any existing SITL instances
pkill -f "arducopter" 2>/dev/null && echo "Killed existing SITL instances" && sleep 1 || true

for i in $(seq 0 $((NUM_INSTANCES - 1))); do
    # Calculate offset longitude (~0.00045 degrees per 50m at this latitude)
    LON_OFFSET=$(echo "$i * 0.00045 * ($SPACING_M / 50)" | bc -l)
    INSTANCE_LON=$(echo "$HOME_LON + $LON_OFFSET" | bc -l)
    INSTANCE_HOME="${HOME_LAT},${INSTANCE_LON},${HOME_ALT},${HOME_HDG}"
    
    TCP_PORT=$((5760 + i * 10))
    
    echo "Starting instance $i (TCP port $TCP_PORT, home: $INSTANCE_HOME)"
    
    cd "$ARDUPILOT_DIR"
    python3 Tools/autotest/sim_vehicle.py \
        -v ArduCopter \
        -I "$i" \
        --no-mavproxy \
        --speedup "$SPEEDUP" \
        -L "$INSTANCE_HOME" \
        --out "tcp:127.0.0.1:${TCP_PORT}" \
        &
    
    # Brief delay between instance launches
    sleep 2
done

echo ""
echo "✅ $NUM_INSTANCES SITL instances launched"
echo ""
echo "Connection strings for pymavlink:"
for i in $(seq 0 $((NUM_INSTANCES - 1))); do
    echo "  drone_$((i+1)): tcp:127.0.0.1:$((5760 + i * 10))"
done
echo ""
echo "Stop all: pkill -f arducopter"

# Wait for all background processes
wait
