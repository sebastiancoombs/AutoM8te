#!/bin/bash

# Start AutoM8te Swarm Manager (FastAPI server)

set -e

echo "================================"
echo "AutoM8te Swarm Manager"
echo "================================"

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Creating one..."
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Start FastAPI server
echo "Starting Swarm Manager on http://localhost:8000"
echo ""
python -m uvicorn swarm_manager.server:app --host 0.0.0.0 --port 8000 --reload
