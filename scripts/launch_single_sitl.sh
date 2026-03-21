#!/bin/bash

# Launch a single ArduPilot SITL instance for testing
# Usage: ./launch_single_sitl.sh

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
echo "AutoM8te Single SITL Launcher"
echo "================================"
echo "ArduPilot: $ARDUPILOT_PATH"
echo "Vehicle: $VEHICLE_TYPE"
echo "Home: $HOME_LOCATION"
echo ""

# Launch SITL
cd "$ARDUPILOT_PATH/$VEHICLE_TYPE"

echo "Launching Drone 1..."
echo "- SITL TCP port: 5760"
echo "- MAVLink UDP: 14550"
echo ""

# Use sim_vehicle.py with TCP connection on port 5760
# This matches our test_mavsdk_connection.py which connects to tcpin://127.0.0.1:5760
python3 "$ARDUPILOT_PATH/Tools/autotest/sim_vehicle.py" \
    -v "$VEHICLE_TYPE" \
    -I 0 \
    --out=tcpout:127.0.0.1:5760 \
    -L "$HOME_LOCATION" \
    --speedup 1 \
    --map \
    --console

echo "SITL stopped."
