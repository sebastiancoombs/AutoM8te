#!/bin/bash
#
# AutoM8te Aerostack2 Startup Script
#
# Usage:
#   ./start-aerostack2.sh [num_drones]
#
# After startup:
#   - Gazebo runs headless inside Docker
#   - On host: run `rerun` then inside container: `python3 /scripts/rerun_viz.py --connect host.docker.internal:9876`
#   - Or: `python3 /scripts/rerun_viz.py --save /scripts/flight.rrd` then copy out
# AutoM8te — Start Aerostack2 Simulation (Headless)
# ONE COMMAND: ./start-aerostack2.sh [num_drones]

set -e

CONTAINER_NAME="aerostack2"
SCRIPTS_DIR="$HOME/Documents/Git/AutoM8te/v2-mcp/scripts"
PROJECT_DIR="/root/project_gazebo"
NUM_DRONES=${1:-4}
CIRCLE_RADIUS=5
ROSBRIDGE_PORT=9090
IMAGE="aerostack2/humble:latest"

echo "🚁 AutoM8te Aerostack2 Startup"
echo "=============================="
echo "Drones: $NUM_DRONES | Foxglove: ws://localhost:$ROSBRIDGE_PORT"
echo ""

# ═══════════════════════════════════════════════════════════════════
# Step 1: Docker
# ═══════════════════════════════════════════════════════════════════
echo "[1/6] Docker..."
if ! docker info > /dev/null 2>&1; then
    open -a "Docker Desktop"
    echo -n "    Waiting"
    for i in {1..30}; do
        sleep 1
        docker info > /dev/null 2>&1 && break
        echo -n "."
    done
    echo ""
    docker info > /dev/null 2>&1 || { echo "❌ Docker not ready"; exit 1; }
fi
echo "    ✅ Running"

# ═══════════════════════════════════════════════════════════════════
# Step 2: Container
# ═══════════════════════════════════════════════════════════════════
echo "[2/6] Container..."
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "    Stopping existing..."
    docker exec $CONTAINER_NAME bash -c "cd $PROJECT_DIR && ./stop.bash 2>/dev/null" || true
    sleep 2
fi

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1
fi

echo "    Pulling image..."
DOCKER_CONFIG=/tmp/docker-nocreds docker pull --platform linux/amd64 "$IMAGE" 2>&1 | tail -1

echo "    Creating container..."
docker run -d --name "$CONTAINER_NAME" --platform linux/amd64 \
    -p ${ROSBRIDGE_PORT}:9090 --privileged \
    "$IMAGE" bash -c "sleep infinity" > /dev/null
sleep 3
echo "    ✅ Created"

# ═══════════════════════════════════════════════════════════════════
# Step 3: project_gazebo + config
# ═══════════════════════════════════════════════════════════════════
echo "[3/6] Project setup..."
if ! docker exec "$CONTAINER_NAME" test -d "$PROJECT_DIR" 2>/dev/null; then
    docker exec "$CONTAINER_NAME" git clone -q https://github.com/aerostack2/project_gazebo "$PROJECT_DIR"
fi

# Generate N-drone circle config
{
    echo 'world_name: "empty"'
    echo 'origin:'
    echo '    latitude: 40.337494'
    echo '    longitude: -3.883197'
    echo '    altitude: 100.0'
    echo 'drones:'
    for i in $(seq 0 $((NUM_DRONES - 1))); do
        angle=$(echo "scale=6; 2 * 3.14159265359 * $i / $NUM_DRONES" | bc)
        x=$(printf "%.3f" $(echo "scale=3; $CIRCLE_RADIUS * c($angle)" | bc -l))
        y=$(printf "%.3f" $(echo "scale=3; $CIRCLE_RADIUS * s($angle)" | bc -l))
        cat << EOF
  - model_type: "quadrotor_base"
    model_name: "drone$i"
    flight_time: 60
    xyz: [$x, $y, 0.2]
    payload:
      - model_type: "gps"
        model_name: "gps"
EOF
    done
} > /tmp/world_autom8te.yaml
docker cp /tmp/world_autom8te.yaml "$CONTAINER_NAME:$PROJECT_DIR/config/world_swarm.yaml" > /dev/null
echo "    ✅ $NUM_DRONES drones configured"

# ═══════════════════════════════════════════════════════════════════
# Step 4: Copy scripts
# ═══════════════════════════════════════════════════════════════════
echo "[4/6] Scripts..."
docker exec "$CONTAINER_NAME" mkdir -p /scripts 2>/dev/null || true
docker cp "$SCRIPTS_DIR/." "$CONTAINER_NAME:/scripts/" 2>/dev/null || true
echo "    ✅ Copied"

# ═══════════════════════════════════════════════════════════════════
# Step 5: Launch simulation (headless)
# ═══════════════════════════════════════════════════════════════════
echo "[5/6] Launching simulation..."

# Start Gazebo headless
docker exec -d "$CONTAINER_NAME" bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && ros2 launch as2_gazebo_assets launch_simulation.py use_sim_time:=true simulation_config_file:=$PROJECT_DIR/config/world_swarm.yaml headless:=true"
echo "    Gazebo starting..."
sleep 10

# Launch each drone's full stack
for i in $(seq 0 $((NUM_DRONES - 1))); do
    drone="drone$i"
    echo "    Launching $drone..."
    
    # Platform
    docker exec -d "$CONTAINER_NAME" bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && cd $PROJECT_DIR && ros2 launch as2_platform_gazebo platform_gazebo_launch.py namespace:=$drone platform_config_file:=config/config.yaml simulation_config_file:=config/world_swarm.yaml" 2>/dev/null
    sleep 2
    
    # State estimator
    docker exec -d "$CONTAINER_NAME" bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && cd $PROJECT_DIR && ros2 launch as2_state_estimator state_estimator_launch.py namespace:=$drone config_file:=config/config.yaml" 2>/dev/null
    
    # Controller
    docker exec -d "$CONTAINER_NAME" bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && cd $PROJECT_DIR && ros2 launch as2_motion_controller controller_launch.py namespace:=$drone config_file:=config/config.yaml plugin_name:=pid_speed_controller plugin_config_file:=config/pid_speed_controller.yaml" 2>/dev/null
    
    # Behaviors (takeoff, land, goto, follow_path)
    docker exec -d "$CONTAINER_NAME" bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && cd $PROJECT_DIR && ros2 launch as2_behaviors_motion motion_behaviors_launch.py namespace:=$drone config_file:=config/config.yaml" 2>/dev/null
    
    sleep 2
done
echo "    ✅ All drones launched"

# ═══════════════════════════════════════════════════════════════════
# Step 6: Rosbridge + Rerun deps
# ═══════════════════════════════════════════════════════════════════
echo "[6/6] Visualization deps..."
docker exec "$CONTAINER_NAME" bash -c "dpkg -l | grep -q ros-humble-rosbridge-server || (apt-get update && apt-get install -y ros-humble-rosbridge-server)" > /dev/null 2>&1 || true
docker exec "$CONTAINER_NAME" bash -c "pip install -q rerun-sdk 2>/dev/null" || true
sleep 2
docker exec -d "$CONTAINER_NAME" bash -c "source /opt/ros/humble/setup.bash && ros2 launch rosbridge_server rosbridge_websocket_launch.xml address:=0.0.0.0 port:=9090"
sleep 2
echo "    ✅ Ready"

# ═══════════════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🚁 AutoM8te Running — $NUM_DRONES drones"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "RERUN (recommended):"
echo "  Host:      pip install rerun-sdk && rerun"
echo "  Container: docker exec -it $CONTAINER_NAME python3 /scripts/rerun_viz.py --connect host.docker.internal:9876"
echo ""
echo "FOXGLOVE:   https://studio.foxglove.dev → ws://localhost:$ROSBRIDGE_PORT"
echo ""
echo "TEST:       Tell drone-pilot: 'check status' or 'take off all drones'"
echo ""
echo "STOP:       docker stop $CONTAINER_NAME"
echo "SHELL:      docker exec -it $CONTAINER_NAME bash"
echo ""
