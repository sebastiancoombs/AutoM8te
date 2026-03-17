#!/bin/bash

# Quick test script for single drone SITL + Swarm Manager

set -e

echo "================================"
echo "AutoM8te Single Drone Test"
echo "================================"
echo ""

# Check if SITL is running
if ! nc -z localhost 14550 2>/dev/null; then
    echo "Error: SITL not running on port 14550"
    echo "Start SITL first with: ./scripts/launch_sitl.sh"
    exit 1
fi

# Check if Swarm Manager is running
if ! nc -z localhost 8000 2>/dev/null; then
    echo "Error: Swarm Manager not running on port 8000"
    echo "Start it with: ./scripts/start_swarm_manager.sh"
    exit 1
fi

echo "✓ SITL running on port 14550"
echo "✓ Swarm Manager running on port 8000"
echo ""

# Register drone
echo "Registering drone_1..."
curl -X POST http://localhost:8000/tools/drone_register \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1", "connection_string": "udp://:14550"}'
echo -e "\n"

sleep 2

# Query telemetry
echo "Querying drone telemetry..."
curl -X POST http://localhost:8000/tools/drone_query \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1"}'
echo -e "\n"

sleep 2

# Takeoff
echo "Commanding takeoff to 5m..."
curl -X POST http://localhost:8000/tools/drone_takeoff \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1", "altitude_m": 5.0}'
echo -e "\n"

sleep 10

# Query again
echo "Querying telemetry after takeoff..."
curl -X POST http://localhost:8000/tools/drone_query \
    -H "Content-Type: application/json" \
    -d '{"drone_id": "drone_1"}'
echo -e "\n"

echo ""
echo "================================"
echo "Test complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Check SITL console to verify drone took off"
echo "2. Try moving: curl -X POST http://localhost:8000/tools/drone_move ..."
echo "3. Land: curl -X POST http://localhost:8000/tools/drone_land ..."
