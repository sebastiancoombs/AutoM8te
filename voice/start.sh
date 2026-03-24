#!/bin/bash
# AutoM8te Voice Control
# Requires: openclaw-discord-realtime installed
# Usage: ./voice/start.sh [realtime|cascade]

MODE=${1:-realtime}
CONFIG="voice/config-${MODE}.json"
TOOLS="voice/tools-drones.json"

if [ ! -f "$CONFIG" ]; then
  echo "❌ Config not found: $CONFIG"
  echo "Usage: $0 [realtime|cascade]"
  exit 1
fi

echo "🚁 AutoM8te Voice Control — ${MODE} mode"
echo "   Config: $CONFIG"
echo "   Tools: $TOOLS"
echo ""

npx openclaw-discord-realtime --config "$CONFIG" --tools "$TOOLS"
