#!/bin/zsh
#
# AutoM8te Launch (Supervisor Mode)
#
# No SITL needed. Webots Supervisor controls all drones directly.
# One physics engine, scales to 20+ drones.
#
# Usage:
#   ./launch_supervisor.sh          # 4 drones
#   ./launch_supervisor.sh 20       # 20 drones
#
# API on http://localhost:8080 (served from inside Webots)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBOTS_BIN="/Applications/Webots.app/Contents/MacOS/webots"
WORLD_FILE="$SCRIPT_DIR/worlds/autom8te_city.wbt"

DRONE_COUNT="${1:-4}"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AutoM8te — Supervisor Mode         ║${NC}"
echo -e "${CYAN}║   Drones: $DRONE_COUNT (single physics engine)    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo

# Check Webots
if [ ! -f "$WEBOTS_BIN" ]; then
    echo "✗ Webots not found"
    exit 1
fi
echo -e "${GREEN}✓${NC} Webots found"

# Update world file with N drones in supervisor mode
echo -e "${CYAN}[1/2] Updating world file with $DRONE_COUNT drones (supervisor mode)...${NC}"
python3 "$SCRIPT_DIR/controllers/drone_spawner/add_drones.py" \
    --count "$DRONE_COUNT" \
    --spacing 5.0 \
    --center-x -45.0 \
    --center-y 45.0 \
    --mode supervisor \
    --world "$WORLD_FILE"
echo

# Launch Webots — supervisor controller starts automatically inside Webots
echo -e "${CYAN}[2/2] Launching Webots...${NC}"
echo "  Supervisor controller will start HTTP API on port 8080"
echo

"$WEBOTS_BIN" "$WORLD_FILE" &
WEBOTS_PID=$!

# Wait for Supervisor API to come up
echo "  Waiting for Supervisor API..."
for i in $(seq 1 20); do
    if curl -s http://localhost:8080/api/status >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Supervisor API ready"
        break
    fi
    sleep 1
done

# Start intent layer with supervisor backend (port 9090 to avoid conflict with supervisor on 8080)
INTENT_LAYER="$SCRIPT_DIR/intent-layer"
if [ -d "$INTENT_LAYER" ]; then
    echo -e "${CYAN}[3/3] Starting intent layer (formations, paths, groups)...${NC}"
    (cd "$INTENT_LAYER" && npm install --silent 2>/dev/null)
    AUTOM8TE_BACKEND=supervisor \
    AUTOM8TE_DRONES="$DRONE_COUNT" \
    AUTOM8TE_PORT=9090 \
    node "$INTENT_LAYER/server.js" &
    INTENT_PID=$!
    echo -e "  ${GREEN}✓${NC} Intent layer on port 9090 (formations, choreography, groups)"
fi

echo
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   AutoM8te is running!               ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
echo -e "${GREEN}║   Drones:  $DRONE_COUNT                          ║${NC}"
echo -e "${GREEN}║   Control: http://localhost:8080      ║${NC}"
echo -e "${GREEN}║   Intent:  http://localhost:9090      ║${NC}"
echo -e "${GREEN}║   Backend: Webots Supervisor          ║${NC}"
echo -e "${GREEN}║   Physics: Single engine (fast!)      ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
echo -e "${GREEN}║   Close Webots to stop                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo
echo -e "${CYAN}Wait ~5s for Webots to load, then:${NC}"
echo "  curl -s http://localhost:8080/api/status | python3 -m json.tool"
echo
echo "  curl -X POST http://localhost:8080/api/takeoff \\"
echo "    -H 'Content-Type: application/json' -d '{\"altitude\": 10}'"
echo
echo "  # Pyramid formation:"
echo "  curl -X POST http://localhost:8080/api/formation \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"positions\": {\"drone_0\": [-47,42,10], \"drone_1\": [-40,42,10], \"drone_2\": [-43.5,48,10], \"drone_3\": [-43.5,44,15]}, \"speed\": 8}'"
echo

wait $WEBOTS_PID
