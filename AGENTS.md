# AGENTS.md — AutoM8te

**READ THIS ENTIRE FILE BEFORE WRITING ANY CODE.**

This file is mandatory reading for any agent (AutoM8te, Codex, Claude Code, or any subagent) working on this codebase.

---

## 🛑 STOP: The One Rule That Cannot Be Broken

**LLM-facing tools take INTENT, not COORDINATES.**

Before you write or modify ANY tool, check this table:

| ✅ ALLOWED | ❌ FORBIDDEN |
|-----------|-------------|
| `direction: "north"` | `x: 45.3` |
| `distance_m: 10` | `y: -12.8` |
| `shape: "line"` | `positions: [[x,y,z], ...]` |
| `area: "ahead"` | `waypoints: [[x,y,z], ...]` |
| `pattern: "grid"` | `path: [[x,y,z], ...]` |

**If your tool schema has x, y, z, coordinates, positions, or waypoints as LLM-facing parameters, DELETE IT AND START OVER.**

The MCP server translates intent → coordinates internally. The LLM never sees or produces coordinates.

---

## Architecture (Non-Negotiable)

```
Human says: "search the field"
           ↓
   Drone-pilot LLM
           ↓
   Tool call: search(area="field", pattern="grid")
           ↓
   MCP Server (THIS CODEBASE)
     - Queries current drone positions
     - Calculates waypoints internally
     - Sends to Aerostack2
           ↓
   Aerostack2 executes
           ↓
   MCP Server returns: "Search started, 4 drones, ETA 5 min"
```

The LLM's job: understand intent, pick the right tool
The MCP server's job: translate to coordinates, ensure safety, execute

---

## Tool Design Checklist

Before adding or modifying any tool in `index.js`, answer these:

1. **Would a human pilot say this naturally?**
   - ✅ "Move north 10 meters"
   - ❌ "Go to position 45.3, -12.8, 10"

2. **Does it require knowledge the LLM doesn't have?**
   - ❌ Current GPS coordinates of drones
   - ❌ World frame orientation
   - ❌ Obstacle positions
   - ✅ Cardinal directions
   - ✅ Relative distances
   - ✅ Shape names

3. **Is the system doing the math, or the LLM?**
   - ✅ System calculates waypoints from "search grid ahead"
   - ❌ LLM provides waypoint array

4. **Is safety handled invisibly?**
   - ✅ System checks collisions, geofence, battery
   - ❌ Tool has "avoid_collision: true" parameter

If ANY answer is wrong, redesign the tool.

---


## Forbidden Patterns

These patterns are BANNED. If you find yourself writing them, stop.

```javascript
// ❌ BANNED: Coordinate parameters
{
  name: "drone_goto",
  inputSchema: {
    properties: {
      x: { type: "number" },  // FORBIDDEN
      y: { type: "number" },  // FORBIDDEN
      z: { type: "number" },  // FORBIDDEN
    }
  }
}

// ❌ BANNED: Waypoint arrays
{
  name: "follow_path",
  inputSchema: {
    properties: {
      waypoints: { type: "array" }  // FORBIDDEN
    }
  }
}

// ❌ BANNED: Position arrays
{
  name: "set_formation",
  inputSchema: {
    properties: {
      positions: { type: "array" }  // FORBIDDEN
    }
  }
}
```

---

## Allowed Patterns

These are the ONLY acceptable parameter types for LLM-facing tools:

```javascript
// ✅ ALLOWED: Direction + distance
{
  name: "move",
  inputSchema: {
    properties: {
      direction: { enum: ["north", "south", "east", "west", "up", "down", "forward", "back", "left", "right"] },
      distance_m: { type: "number" }
    }
  }
}

// ✅ ALLOWED: Shape + spacing
{
  name: "form",
  inputSchema: {
    properties: {
      shape: { enum: ["line", "v", "circle", "grid", "column"] },
      spacing_m: { type: "number" }
    }
  }
}

// ✅ ALLOWED: Area description + pattern
{
  name: "search",
  inputSchema: {
    properties: {
      area: { type: "string" },  // "ahead", "left side", "50m radius"
      pattern: { enum: ["grid", "spiral", "expanding"] }
    }
  }
}

// ✅ ALLOWED: Simple verbs
{
  name: "takeoff",
  inputSchema: {
    properties: {
      altitude_m: { type: "number" }  // Optional, has default
    }
  }
}
```

---

## Status Tool Output

Status must return HUMAN-READABLE summaries, not raw data:

```javascript
// ✅ CORRECT
"4 drones airborne at 10m, battery 75-82%, holding position"

// ❌ WRONG
{
  "drone0": {"position": [5.2, -3.1, 10.0], "battery": 0.82, ...},
  "drone1": {"position": [10.1, -3.0, 10.1], "battery": 0.75, ...},
  ...
}
```

The LLM doesn't need to parse JSON. Give it a sentence.

---

## If You're Unsure

1. Ask: "Would I say this to a human helicopter pilot?"
2. If no → redesign
3. If still unsure → ask seabass before implementing

---

## Enforcement

Any PR or commit that adds coordinate-based tool parameters will be rejected.

This is not a guideline. This is the architecture.
