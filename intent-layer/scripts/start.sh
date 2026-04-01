#!/bin/bash
# AutoM8te Startup Script
#
# Usage:
#   ./start.sh                    # Mock backend (no sim, instant feedback)
#   ./start.sh ardupilot          # ArduPilot SITL only (headless)
#   ./start.sh ardupilot 4        # ArduPilot SITL with 4 drones
#   ./start.sh webots             # ArduPilot + Webots (physics + viz)
#   ./start.sh pybullet           # PyBullet (requires gym-pybullet-drones)
#
# Environment variables:
#   ARDUPILOT_PATH   - Path to ardupilot repo (required for webots)
#   AUTOM8TE_GUI     - Set to 'true' for GUI in pybullet

set -e

BACKEND=${1:-mock}
DRONE_COUNT=${2:-4}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTENT_LAYER_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}AutoM8te Intent Layer${NC}"
echo "Backend: $BACKEND"
echo "Drones: $DRONE_COUNT"
echo ""

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    pkill -f sim_vehicle.py 2>/dev/null || true
    pkill -f ardupilot_bridge.py 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

case $BACKEND in
    mock)
        echo -e "${GREEN}Starting mock backend (no simulation)${NC}"
        echo "This is instant — no external dependencies."
        echo ""
        cd "$INTENT_LAYER_DIR"
        AUTOM8TE_BACKEND=mock AUTOM8TE_DRONES=$DRONE_COUNT node server.js
        ;;
        
    ardupilot)
        echo -e "${GREEN}Starting ArduPilot SITL...${NC}"
        
        # Check for sim_vehicle.py
        if ! command -v sim_vehicle.py &> /dev/null; then
            echo -e "${RED}Error: sim_vehicle.py not found${NC}"
            echo "Install ArduPilot or add to PATH:"
            echo "  brew install ardupilot"
            echo "  # or"
            echo "  git clone https://github.com/ArduPilot/ardupilot"
            echo "  export PATH=\$PATH:/path/to/ardupilot/Tools/autotest"
            exit 1
        fi
        
        # Check for pymavlink
        if ! python3 -c "import pymavlink" 2>/dev/null; then
            echo -e "${RED}Error: pymavlink not installed${NC}"
            echo "Install: pip install pymavlink"
            exit 1
        fi
        
        # Kill existing
        pkill -f sim_vehicle.py 2>/dev/null || true
        sleep 1
        
        # Start SITL instances
        BASE_PORT=14550
        PORT_STEP=10
        PORTS=""
        
        for ((i=0; i<DRONE_COUNT; i++)); do
            PORT=$((BASE_PORT + i * PORT_STEP))
            PORTS="${PORTS}${PORT},"
            
            echo "  Starting drone$i on port $PORT..."
            sim_vehicle.py -v ArduCopter \
                --instance $i \
                -I$i \
                --out udp:127.0.0.1:$PORT \
                --no-mavproxy \
                > /tmp/sitl_drone${i}.log 2>&1 &
        done
        PORTS=${PORTS%,}  # Remove trailing comma
        
        echo ""
        echo -e "${YELLOW}Waiting for SITL to initialize (15-30 seconds)...${NC}"
        sleep 15
        
        echo -e "${GREEN}Starting intent layer...${NC}"
        cd "$INTENT_LAYER_DIR"
        AUTOM8TE_BACKEND=ardupilot AUTOM8TE_DRONES=$DRONE_COUNT node server.js
        ;;
        
    webots)
        echo -e "${GREEN}Starting ArduPilot + Webots...${NC}"
        
        AUTOM8TE_ROOT="$(cd "$INTENT_LAYER_DIR/.." && pwd)"
        WEBOTS_WORLD="$AUTOM8TE_ROOT/worlds/autom8te_city.wbt"
        IRIS_PARM="$AUTOM8TE_ROOT/worlds/params/iris.parm"
        
        # Check for sim_vehicle.py
        if ! command -v sim_vehicle.py &> /dev/null; then
            echo -e "${RED}Error: sim_vehicle.py not found${NC}"
            echo "Install ArduPilot or add to PATH:"
            echo "  git clone https://github.com/ArduPilot/ardupilot"
            echo "  export PATH=\$PATH:/path/to/ardupilot/Tools/autotest"
            exit 1
        fi
        
        # Check for pymavlink
        if ! python3 -c "import pymavlink" 2>/dev/null; then
            echo -e "${RED}Error: pymavlink not installed${NC}"
            echo "Install: pip install pymavlink"
            exit 1
        fi
        
        # Check for Webots
        if ! command -v webots &> /dev/null && [ ! -d "/Applications/Webots.app" ]; then
            echo -e "${RED}Error: Webots not installed${NC}"
            echo "Install: brew install --cask webots"
            exit 1
        fi
        
        # Check world file
        if [ ! -f "$WEBOTS_WORLD" ]; then
            echo -e "${RED}Error: World file not found at:${NC}"
            echo "  $WEBOTS_WORLD"
            exit 1
        fi
        
        # Kill existing SITL
        pkill -f sim_vehicle.py 2>/dev/null || true
        sleep 1
        
        # Inject drones into world file
        DRONE_SPAWNER="$AUTOM8TE_ROOT/controllers/drone_spawner/add_drones.py"
        if [ -f "$DRONE_SPAWNER" ]; then
            echo -e "${GREEN}Injecting $DRONE_COUNT drones into world...${NC}"
            python3 "$DRONE_SPAWNER" \
                --count "$DRONE_COUNT" \
                --world "$WEBOTS_WORLD"
        else
            echo -e "${RED}Error: drone spawner not found at $DRONE_SPAWNER${NC}"
            exit 1
        fi
        
        # Launch Webots with our city world
        echo -e "${GREEN}Opening Webots with AutoM8te city...${NC}"
        if [ -d "/Applications/Webots.app" ]; then
            open -a Webots "$WEBOTS_WORLD" &
        else
            webots "$WEBOTS_WORLD" &
        fi
        
        echo -e "${YELLOW}Waiting for Webots to load (10 seconds)...${NC}"
        sleep 10
        
        # Start SITL instances with webots-python model
        BASE_PORT=14550
        PORT_STEP=10
        PORTS=""
        
        for ((i=0; i<DRONE_COUNT; i++)); do
            PORT=$((BASE_PORT + i * PORT_STEP))
            PORTS="${PORTS}${PORT},"
            
            echo "  Starting SITL drone$i → port $PORT (webots-python model, robot=drone_$i)..."
            WEBOTS_ROBOT_NAME="drone_$i" \
            sim_vehicle.py -v ArduCopter \
                --model webots-python \
                --instance $i \
                -I$i \
                --out udp:127.0.0.1:$PORT \
                --add-param-file="$IRIS_PARM" \
                --no-mavproxy \
                --no-rebuild \
                > /tmp/sitl_drone${i}.log 2>&1 &
        done
        PORTS=${PORTS%,}
        
        echo ""
        echo -e "${YELLOW}Waiting for SITL to connect to Webots (15-30 seconds)...${NC}"
        echo "Check Webots console for 'Connected to ardupilot SITL' messages."
        sleep 20
        
        echo -e "${GREEN}Starting intent layer HTTP server...${NC}"
        cd "$INTENT_LAYER_DIR"
        AUTOM8TE_BACKEND=ardupilot \
        AUTOM8TE_DRONES=$DRONE_COUNT \
        node server.js
        ;;
        
    pybullet)
        echo -e "${GREEN}Starting PyBullet backend...${NC}"
        
        # Check for gym-pybullet-drones
        if ! python3 -c "import gym_pybullet_drones" 2>/dev/null; then
            echo -e "${RED}Error: gym-pybullet-drones not installed${NC}"
            echo "Install: pip install gym-pybullet-drones"
            exit 1
        fi
        
        cd "$INTENT_LAYER_DIR"
        AUTOM8TE_BACKEND=pybullet \
        AUTOM8TE_DRONES=$DRONE_COUNT \
        AUTOM8TE_GUI=${AUTOM8TE_GUI:-true} \
        node server.js
        ;;
        
    *)
        echo -e "${RED}Unknown backend: $BACKEND${NC}"
        echo ""
        echo "Available backends:"
        echo "  mock       - No simulation (testing)"
        echo "  ardupilot  - ArduPilot SITL (headless)"
        echo "  webots     - ArduPilot + Webots (physics + viz)"
        echo "  pybullet   - PyBullet gym-pybullet-drones"
        exit 1
        ;;
esac
