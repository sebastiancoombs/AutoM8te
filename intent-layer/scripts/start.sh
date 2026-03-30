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
        AUTOM8TE_BACKEND=mock AUTOM8TE_DRONES=$DRONE_COUNT node index.js
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
        AUTOM8TE_BACKEND=ardupilot AUTOM8TE_DRONES=$DRONE_COUNT node index.js
        ;;
        
    webots)
        echo -e "${GREEN}Starting ArduPilot + Webots...${NC}"
        
        # Check ARDUPILOT_PATH
        if [ -z "$ARDUPILOT_PATH" ]; then
            echo -e "${RED}Error: ARDUPILOT_PATH not set${NC}"
            echo "Set it to your ardupilot repo:"
            echo "  export ARDUPILOT_PATH=/path/to/ardupilot"
            exit 1
        fi
        
        WEBOTS_WORLD="$ARDUPILOT_PATH/libraries/SITL/examples/Webots_Python/worlds/iris.wbt"
        if [ ! -f "$WEBOTS_WORLD" ]; then
            echo -e "${RED}Error: Webots world not found at:${NC}"
            echo "  $WEBOTS_WORLD"
            echo "Make sure ARDUPILOT_PATH points to a valid ardupilot clone."
            exit 1
        fi
        
        # Check for Webots
        if ! command -v webots &> /dev/null; then
            echo -e "${RED}Error: Webots not installed${NC}"
            echo "Install: brew install --cask webots"
            exit 1
        fi
        
        echo ""
        echo -e "${YELLOW}IMPORTANT: Start Webots first!${NC}"
        echo "1. Open Webots"
        echo "2. File > Open World..."
        echo "3. Select: $WEBOTS_WORLD"
        echo "4. Press Run in Webots"
        echo ""
        echo "Press Enter when Webots is running..."
        read -r
        
        echo -e "${GREEN}Starting intent layer with Webots backend...${NC}"
        cd "$INTENT_LAYER_DIR"
        AUTOM8TE_BACKEND=webots \
        AUTOM8TE_DRONES=$DRONE_COUNT \
        ARDUPILOT_PATH="$ARDUPILOT_PATH" \
        node index.js
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
        node index.js
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
