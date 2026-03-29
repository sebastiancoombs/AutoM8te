# AGENTS.md — AutoM8te MCP Server

**READ THE ROOT AGENTS.md FIRST: `~/Documents/Git/AutoM8te/AGENTS.md`**

This directory contains the MCP server that translates LLM intent into drone commands.

---

## Your Job

You are the TRANSLATION LAYER between:
- **Input:** High-level intent from LLM ("move north 10m", "form a line")
- **Output:** Low-level commands to Aerostack2 (coordinates, waypoints)

The LLM never sees coordinates. You calculate them.

---

## File Structure

```
v2-mcp/
├── index.js              # MCP Server - tool definitions + handlers
├── scripts/              # Python commands run in Aerostack2 container
│   ├── cmd_takeoff.py
│   ├── cmd_land.py
│   ├── cmd_move.py       # Takes direction + distance, calculates coords
│   ├── cmd_form.py       # Takes shape + spacing, calculates positions
│   ├── cmd_search.py     # Takes area + pattern, generates waypoints
│   ├── cmd_hover.py
│   ├── cmd_rtl.py
│   ├── cmd_status.py     # Returns human-readable summary
│   └── cmd_emergency.py
├── behaviors/            # Saved behavior configs
└── start-aerostack2.sh   # One-command simulation startup
```

---

## Tool Implementation Rules

### In `index.js`:

1. **Tool schemas use intent parameters only** (direction, shape, pattern)
2. **Handlers query current state** before calculating coordinates
3. **Handlers return human-readable results** ("Moved north 10m, now at altitude 15m")

### In `scripts/cmd_*.py`:

1. **Accept intent parameters** from command line
2. **Query ROS2 for current state** (position, orientation)
3. **Calculate coordinates internally**
4. **Execute via Aerostack2 Python API**
5. **Return human-readable JSON** (success message, not raw coords)

---

## Translation Examples

### Move Tool

LLM calls: `move(direction="north", distance_m=10)`

Script does:
1. Get current position from `/droneX/self_localization/pose`
2. Get current heading from orientation
3. Calculate: `new_x = current_x + 10` (if north = +x)
4. Call Aerostack2: `drone.go_to(new_x, current_y, current_z)`
5. Return: `"Moved north 10m"`

### Form Tool

LLM calls: `form(shape="line", spacing_m=5)`

Script does:
1. Get all drone positions
2. Calculate centroid
3. Calculate line positions: `[-10, -5, 0, 5, 10]` on x-axis from centroid
4. Assign each drone to nearest target
5. Send go_to commands
6. Return: `"Forming line, 5m spacing, 4 drones moving"`

### Search Tool

LLM calls: `search(area="ahead 50m", pattern="grid")`

Script does:
1. Get lead drone position and heading
2. Define search box: 50m ahead, 30m wide
3. Generate grid waypoints at 10m intervals
4. Assign waypoints to drones
5. Start mission
6. Return: `"Grid search started, 50x30m area, ETA 8 min"`

---

## Status Output Format

```python
# ✅ CORRECT
return {
    "summary": "4 drones airborne at 10-12m, battery 75-85%, holding",
    "drones": {
        "drone0": "10m, 82%, holding",
        "drone1": "11m, 79%, holding",
        ...
    }
}

# ❌ WRONG - raw coordinates
return {
    "drone0": {"x": 5.2, "y": -3.1, "z": 10.0, "battery": 0.82}
}
```

---

## Testing

Before any commit:
1. Start simulation: `./start-aerostack2.sh 4`
2. Test via drone-pilot: "take off" → "move north 10m" → "form a line" → "land"
3. Verify LLM never sees coordinates in tool responses

---

## If You Break The Rules

If you add x/y/z parameters to any tool, the PR will be rejected and you'll have to rewrite it. Save yourself the time — follow the architecture.
