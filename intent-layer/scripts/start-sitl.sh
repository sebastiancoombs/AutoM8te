#!/bin/bash
# Start multiple ArduPilot SITL instances
#
# Usage: ./start-sitl.sh [count]
# Default: 4 drones
#
# Prerequisites:
#   brew install ardupilot  # or build from source
#   pip install pymavlink

COUNT=${1:-4}
BASE_PORT=14550
PORT_STEP=10

echo "Starting $COUNT ArduPilot SITL instances..."

# Kill any existing SITL processes
pkill -f sim_vehicle.py 2>/dev/null
sleep 1

# Start each instance in background
for ((i=0; i<COUNT; i++)); do
    PORT=$((BASE_PORT + i * PORT_STEP))
    INSTANCE=$i
    
    echo "  drone$i: port $PORT"
    
    # Run in background, redirect output to log files
    sim_vehicle.py -v ArduCopter \
        --instance $INSTANCE \
        -I$INSTANCE \
        --out udp:127.0.0.1:$PORT \
        --no-mavproxy \
        > /tmp/sitl_drone${i}.log 2>&1 &
done

echo ""
echo "SITL instances starting (may take 10-20 seconds to initialize)..."
echo "Logs: /tmp/sitl_drone*.log"
echo ""
echo "To connect intent layer:"
echo "  AUTOM8TE_BACKEND=ardupilot AUTOM8TE_DRONES=$COUNT node index.js"
echo ""
echo "To stop all:"
echo "  pkill -f sim_vehicle.py"
