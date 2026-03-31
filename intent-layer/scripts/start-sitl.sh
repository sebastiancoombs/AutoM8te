#!/bin/bash
# Start multiple ArduPilot SITL instances
#
# Usage:
#   ./start-sitl.sh [count] [model]
#
# Examples:
#   ./start-sitl.sh 4                  # 4 headless SITL instances
#   ./start-sitl.sh 4 webots-python    # 4 SITL connected to Webots
#
# Prerequisites:
#   sim_vehicle.py on PATH (from ardupilot repo)
#   pip install pymavlink

COUNT=${1:-4}
MODEL=${2:-}  # empty = headless, 'webots-python' = Webots
BASE_PORT=14550
PORT_STEP=10
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IRIS_PARM="$SCRIPT_DIR/../../worlds/params/iris.parm"

echo "Starting $COUNT ArduPilot SITL instances..."
[ -n "$MODEL" ] && echo "Model: $MODEL"

# Kill any existing SITL processes
pkill -f sim_vehicle.py 2>/dev/null
sleep 1

# Build model args
MODEL_ARGS=""
if [ -n "$MODEL" ]; then
    MODEL_ARGS="--model $MODEL"
fi

PARAM_ARGS=""
if [ -f "$IRIS_PARM" ]; then
    PARAM_ARGS="--add-param-file=$IRIS_PARM"
fi

# Start each instance in background
for ((i=0; i<COUNT; i++)); do
    PORT=$((BASE_PORT + i * PORT_STEP))
    
    echo "  drone$i: port $PORT"
    
    sim_vehicle.py -v ArduCopter \
        $MODEL_ARGS \
        --instance $i \
        -I$i \
        --out udp:127.0.0.1:$PORT \
        $PARAM_ARGS \
        --no-mavproxy \
        > /tmp/sitl_drone${i}.log 2>&1 &
done

echo ""
echo "SITL instances starting (may take 15-30 seconds)..."
echo "Logs: /tmp/sitl_drone*.log"
echo ""
echo "To connect intent layer:"
echo "  AUTOM8TE_BACKEND=ardupilot AUTOM8TE_DRONES=$COUNT node index.js"
echo ""
echo "To stop all:"
echo "  pkill -f sim_vehicle.py"
