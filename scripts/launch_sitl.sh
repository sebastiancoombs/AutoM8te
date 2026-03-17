#!/bin/bash

# Launch ArduPilot SITL instances for AutoM8te
# Requires ArduPilot installed and built

set -e

# Configuration
ARDUPILOT_PATH="${ARDUPILOT_PATH:-$HOME/ardupilot}"
VEHICLE_TYPE="ArduCopter"
HOME_LOCATION="-35.363261,149.165230,584,353"  # Canberra, Australia

# Check if ArduPilot is installed
if [ ! -d "$ARDUPILOT_PATH" ]; then
    echo "Error: ArduPilot not found at $ARDUPILOT_PATH"
    echo "Set ARDUPILOT_PATH environment variable or install ArduPilot"
    exit 1
fi

echo "================================"
echo "AutoM8te SITL Launcher"
echo "================================"
echo "ArduPilot: $ARDUPILOT_PATH"
echo "Vehicle: $VEHICLE_TYPE"
echo "Home: $HOME_LOCATION"
echo ""

# Launch SITL instances
cd "$ARDUPILOT_PATH/$VEHICLE_TYPE"

echo "Launching Drone 1 (UDP 14550, SITL 9003)..."
sim_vehicle.py -v $VEHICLE_TYPE -I 0 \
    --out=udp:127.0.0.1:14550 \
    -L $HOME_LOCATION \
    --speedup 1 \
    --map \
    --console &
SITL1_PID=$!

sleep 5

echo "Launching Drone 2 (UDP 14560, SITL 9013)..."
sim_vehicle.py -v $VEHICLE_TYPE -I 1 \
    --out=udp:127.0.0.1:14560 \
    -L $HOME_LOCATION \
    --speedup 1 &
SITL2_PID=$!

sleep 5

echo "Launching Drone 3 (UDP 14570, SITL 9023)..."
sim_vehicle.py -v $VEHICLE_TYPE -I 2 \
    --out=udp:127.0.0.1:14570 \
    -L $HOME_LOCATION \
    --speedup 1 &
SITL3_PID=$!

sleep 5

echo "Launching Drone 4 (UDP 14580, SITL 9033)..."
sim_vehicle.py -v $VEHICLE_TYPE -I 3 \
    --out=udp:127.0.0.1:14580 \
    -L $HOME_LOCATION \
    --speedup 1 &
SITL4_PID=$!

echo ""
echo "================================"
echo "All SITL instances launched!"
echo "================================"
echo "Drone 1: UDP 14550 (PID: $SITL1_PID)"
echo "Drone 2: UDP 14560 (PID: $SITL2_PID)"
echo "Drone 3: UDP 14570 (PID: $SITL3_PID)"
echo "Drone 4: UDP 14580 (PID: $SITL4_PID)"
echo ""
echo "Press Ctrl+C to stop all SITL instances"

# Cleanup on exit
cleanup() {
    echo ""
    echo "Stopping all SITL instances..."
    kill $SITL1_PID $SITL2_PID $SITL3_PID $SITL4_PID 2>/dev/null || true
    exit 0
}

trap cleanup INT TERM

# Wait for all processes
wait
