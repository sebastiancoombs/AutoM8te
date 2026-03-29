#!/usr/bin/env node
/**
 * AutoM8te MCP Server
 * Drone swarm control via Aerostack2 with streaming telemetry
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { spawn, exec } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BEHAVIORS_DIR = join(__dirname, "behaviors");
const SCRIPTS_DIR = join(__dirname, "scripts");

// Config
const CONTAINER = process.env.AUTOM8TE_CONTAINER || "aerostack2";
const DEFAULT_SPEED = 1.5;
const DEFAULT_ALTITUDE = 5;
const DRONES = ["drone0", "drone1", "drone2", "drone3", "drone4"];

// State (updated by telemetry subscription)
let droneState = {};
let eventLog = [];
let activeMissions = {};

// ═══════════════════════════════════════════════════════════════════
// Behavior Config Management
// ═══════════════════════════════════════════════════════════════════

function loadBehaviorIndex() {
  const path = join(BEHAVIORS_DIR, "_index.json");
  if (!existsSync(path)) return { version: 1, behaviors: [] };
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveBehaviorIndex(index) {
  writeFileSync(join(BEHAVIORS_DIR, "_index.json"), JSON.stringify(index, null, 2));
}

function loadBehavior(name) {
  const path = join(BEHAVIORS_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveBehavior(behavior) {
  writeFileSync(join(BEHAVIORS_DIR, `${behavior.name}.json`), JSON.stringify(behavior, null, 2));
  const index = loadBehaviorIndex();
  if (!index.behaviors.includes(behavior.name)) {
    index.behaviors.push(behavior.name);
    saveBehaviorIndex(index);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Command Execution
// ═══════════════════════════════════════════════════════════════════

function execInContainer(script, args) {
  return new Promise((resolve, reject) => {
    const argStr = Object.entries(args)
      .map(([k, v]) => {
        if (typeof v === "boolean") return v ? `--${k}` : "";
        if (Array.isArray(v) || typeof v === "object") return `--${k} '${JSON.stringify(v)}'`;
        return `--${k} "${v}"`;
      })
      .filter(Boolean)
      .join(" ");

    // Must source ROS2 and Aerostack2 setup before running Python scripts
    const cmd = `docker exec ${CONTAINER} bash -c "source /opt/ros/humble/setup.bash && source /root/aerostack2_ws/install/setup.bash && python3 /scripts/${script} ${argStr}"`;
    
    exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr });
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ output: stdout.trim(), stderr: stderr.trim() });
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════════════════════════

const server = new Server(
  {
    name: "autom8te",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: { subscribe: true },
    },
  }
);

// ═══════════════════════════════════════════════════════════════════
// Resources (streaming)
// ═══════════════════════════════════════════════════════════════════

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "autom8te://telemetry",
      name: "Drone Telemetry",
      description: "Live position, velocity, battery, status for all drones",
      mimeType: "application/json",
    },
    {
      uri: "autom8te://events",
      name: "Event Stream",
      description: "Detections, alerts, mission events, errors",
      mimeType: "application/json",
    },
    {
      uri: "autom8te://missions",
      name: "Active Missions",
      description: "Currently running missions and their progress",
      mimeType: "application/json",
    },
    {
      uri: "autom8te://behaviors",
      name: "Behavior Library",
      description: "Available behavior configurations",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "autom8te://telemetry":
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            timestamp: new Date().toISOString(),
            drones: droneState,
          }, null, 2),
        }],
      };

    case "autom8te://events":
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            events: eventLog.slice(-50),
          }, null, 2),
        }],
      };

    case "autom8te://missions":
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            active: activeMissions,
          }, null, 2),
        }],
      };

    case "autom8te://behaviors":
      const index = loadBehaviorIndex();
      const behaviors = index.behaviors.map(name => {
        const b = loadBehavior(name);
        return { name: b.name, type: b.type, description: b.description };
      });
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ behaviors }, null, 2),
        }],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === "autom8te://telemetry") {
    startTelemetryStream();
  }
  return {};
});

// ═══════════════════════════════════════════════════════════════════
// Telemetry Streaming
// ═══════════════════════════════════════════════════════════════════

let telemetryInterval = null;

function startTelemetryStream() {
  if (telemetryInterval) return;
  
  telemetryInterval = setInterval(async () => {
    try {
      const result = await execInContainer("cmd_query.py", { drones: DRONES.join(",") });
      if (result.success) {
        droneState = result.drones;
        server.notification({
          method: "notifications/resources/updated",
          params: { uri: "autom8te://telemetry" },
        });
      }
    } catch (e) {
      addEvent("error", `Telemetry fetch failed: ${e.message}`);
    }
  }, 1000);
}

function addEvent(type, message, data = {}) {
  eventLog.push({
    timestamp: new Date().toISOString(),
    type,
    message,
    ...data,
  });
  if (eventLog.length > 500) {
    eventLog = eventLog.slice(-250);
  }
  server.notification({
    method: "notifications/resources/updated",
    params: { uri: "autom8te://events" },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Tools - Valid JSON Schema 2020-12
// ═══════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: "drone_takeoff",
    description: "Take off one or more drones to specified altitude. Omit drone_ids for all drones. Default altitude is 5m, speed is 1 m/s.",
    inputSchema: {
      type: "object",
      properties: {
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drone IDs to take off (omit for all)" 
        },
        altitude_m: { 
          type: "number", 
          description: "Takeoff altitude in meters (default: 5)" 
        },
        speed_ms: { 
          type: "number", 
          description: "Takeoff speed in m/s (default: 1)" 
        }
      }
    }
  },
  {
    name: "drone_land",
    description: "Land one or more drones. Omit drone_ids for all drones. Default speed is 0.5 m/s.",
    inputSchema: {
      type: "object",
      properties: {
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drone IDs to land (omit for all)" 
        },
        speed_ms: { 
          type: "number", 
          description: "Landing speed in m/s (default: 0.5)" 
        }
      }
    }
  },
  {
    name: "drone_goto",
    description: "Move a single drone to a position. Requires drone_id and x, y, z coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        drone_id: { 
          type: "string", 
          description: "Drone ID" 
        },
        x: { 
          type: "number", 
          description: "X position (north) in meters" 
        },
        y: { 
          type: "number", 
          description: "Y position (east) in meters" 
        },
        z: { 
          type: "number", 
          description: "Z position (altitude) in meters" 
        },
        speed_ms: { 
          type: "number", 
          description: "Speed in m/s (default: 1.5)" 
        },
        yaw_mode: { 
          type: "string", 
          enum: ["keep", "path_facing", "fixed"], 
          description: "Yaw mode (default: keep)" 
        }
      },
      required: ["drone_id", "x", "y", "z"]
    }
  },
  {
    name: "drone_follow_path",
    description: "Drone follows a waypoint path. Waypoints are [[x,y,z], ...]",
    inputSchema: {
      type: "object",
      properties: {
        drone_id: { 
          type: "string", 
          description: "Drone ID" 
        },
        waypoints: { 
          type: "array", 
          items: { 
            type: "array",
            items: { type: "number" }
          }, 
          description: "Waypoints as [[x,y,z], ...]" 
        },
        speed_ms: { 
          type: "number", 
          description: "Speed in m/s (default: 1.5)" 
        }
      },
      required: ["drone_id", "waypoints"]
    }
  },
  {
    name: "drone_hover",
    description: "Stop drone(s) and hover in place. Omit drone_ids for all.",
    inputSchema: {
      type: "object",
      properties: {
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drone IDs (omit for all)" 
        }
      }
    }
  },
  {
    name: "drone_rtl",
    description: "Return to launch position. Default altitude 10m, lands after returning.",
    inputSchema: {
      type: "object",
      properties: {
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drone IDs (omit for all)" 
        },
        altitude_m: { 
          type: "number", 
          description: "RTL altitude in meters (default: 10)" 
        },
        land: { 
          type: "boolean", 
          description: "Land after reaching home (default: true)" 
        }
      }
    }
  },
  {
    name: "drone_emergency",
    description: "Emergency stop — land all drones immediately",
    inputSchema: {
      type: "object",
      properties: {
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drone IDs (omit for all)" 
        }
      }
    }
  },
  {
    name: "swarm_formation",
    description: "Set swarm formation. Available: line, triangle, circle, square, v, custom",
    inputSchema: {
      type: "object",
      properties: {
        formation: { 
          type: "string", 
          enum: ["line", "triangle", "circle", "square", "v", "custom"],
          description: "Formation type"
        },
        spacing_m: { 
          type: "number", 
          description: "Spacing between drones in meters (default: 5)" 
        },
        altitude_m: { 
          type: "number", 
          description: "Formation altitude (default: 10)" 
        },
        heading_deg: { 
          type: "number", 
          description: "Formation heading in degrees (default: 0)" 
        },
        custom_offsets: { 
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }
          },
          description: "For custom formation: [[x,y,z], ...] offsets from centroid" 
        }
      },
      required: ["formation"]
    }
  },
  {
    name: "swarm_search",
    description: "Area search pattern. Patterns: grid, spiral, expanding_square",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { 
          type: "string", 
          enum: ["grid", "spiral", "expanding_square"],
          description: "Search pattern (default: grid)"
        },
        area: { 
          type: "object",
          properties: {
            center: { 
              type: "array", 
              items: { type: "number" },
              description: "[x, y] center point"
            },
            width: { type: "number", description: "Width in meters" },
            height: { type: "number", description: "Height in meters" }
          },
          description: "Search area definition"
        },
        altitude_m: { 
          type: "number", 
          description: "Search altitude (default: 15)" 
        },
        swath_width_m: { 
          type: "number", 
          description: "Swath width for grid pattern (default: 10)" 
        },
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drones to use (omit for all)" 
        }
      },
      required: ["area"]
    }
  },
  {
    name: "behavior_create",
    description: "Create a new reusable behavior configuration",
    inputSchema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "Behavior name" 
        },
        description: { 
          type: "string", 
          description: "What the behavior does" 
        },
        type: { 
          type: "string", 
          enum: ["search", "patrol", "formation", "tracking", "pattern"],
          description: "Behavior type"
        },
        params: { 
          type: "object", 
          description: "Parameter definitions" 
        },
        based_on: { 
          type: "string", 
          description: "Clone from existing behavior" 
        }
      },
      required: ["name", "description"]
    }
  },
  {
    name: "behavior_update",
    description: "Update behavior stats/notes after execution for learning",
    inputSchema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "Behavior name" 
        },
        success: { 
          type: "boolean", 
          description: "Was execution successful?" 
        },
        note: { 
          type: "string", 
          description: "Lesson learned or observation" 
        }
      },
      required: ["name"]
    }
  },
  {
    name: "drone_status",
    description: "Get current status of all drones: position (x,y,z), battery, armed state, flight mode",
    inputSchema: {
      type: "object",
      properties: {
        drone_ids: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Drone IDs to query (omit for all)" 
        }
      }
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "drone_takeoff": {
        const drones = args.drone_ids?.join(",") || DRONES.join(",");
        addEvent("command", `Takeoff: ${drones} to ${args.altitude_m || DEFAULT_ALTITUDE}m`);
        const result = await execInContainer("cmd_takeoff.py", {
          drones,
          height: args.altitude_m || DEFAULT_ALTITUDE,
          speed: args.speed_ms || 1,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "drone_land": {
        const drones = args.drone_ids?.join(",") || DRONES.join(",");
        addEvent("command", `Land: ${drones}`);
        const result = await execInContainer("cmd_land.py", {
          drones,
          speed: args.speed_ms || 0.5,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "drone_goto": {
        addEvent("command", `Goto: ${args.drone_id} to [${args.x}, ${args.y}, ${args.z}]`);
        const result = await execInContainer("cmd_goto.py", {
          drone: args.drone_id,
          x: args.x,
          y: args.y,
          z: args.z,
          speed: args.speed_ms || DEFAULT_SPEED,
          yaw: args.yaw_mode || "keep",
          wait: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "drone_follow_path": {
        addEvent("command", `Follow path: ${args.drone_id}, ${args.waypoints.length} waypoints`);
        const result = await execInContainer("cmd_follow_path.py", {
          drone: args.drone_id,
          waypoints: JSON.stringify(args.waypoints),
          speed: args.speed_ms || DEFAULT_SPEED,
          wait: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "drone_hover": {
        const drones = args.drone_ids?.join(",") || DRONES.join(",");
        addEvent("command", `Hover: ${drones}`);
        const result = await execInContainer("cmd_hover.py", { drones });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "drone_rtl": {
        const drones = args.drone_ids?.join(",") || DRONES.join(",");
        addEvent("command", `RTL: ${drones}`);
        const result = await execInContainer("cmd_rtl.py", {
          drones,
          altitude: args.altitude_m || 10,
          land: args.land ?? true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "drone_emergency": {
        const drones = args.drone_ids?.join(",") || DRONES.join(",");
        addEvent("emergency", `EMERGENCY STOP: ${drones}`);
        const result = await execInContainer("cmd_emergency.py", { drones });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "swarm_formation": {
        addEvent("command", `Formation: ${args.formation}, spacing ${args.spacing_m || 5}m`);
        
        const n = DRONES.length;
        const spacing = args.spacing_m || 5;
        const altitude = args.altitude_m || DEFAULT_ALTITUDE;
        
        const formations = {
          line: () => DRONES.map((_, i) => [(i - (n-1)/2) * spacing, 0, altitude]),
          triangle: () => [[0, 0, altitude], [-spacing, -spacing/2, altitude], [-spacing, spacing/2, altitude]],
          circle: () => {
            const radius = (spacing * n) / (2 * Math.PI);
            return DRONES.map((_, i) => {
              const angle = (2 * Math.PI * i) / n;
              return [radius * Math.cos(angle), radius * Math.sin(angle), altitude];
            });
          },
          square: () => {
            const side = Math.ceil(Math.sqrt(n));
            return DRONES.map((_, i) => [
              (i % side - (side-1)/2) * spacing,
              (Math.floor(i / side) - (side-1)/2) * spacing,
              altitude,
            ]);
          },
          v: () => DRONES.map((_, i) => {
            const side = i % 2 === 0 ? 1 : -1;
            const pos = Math.floor((i + 1) / 2);
            return [-pos * spacing * 0.7, side * pos * spacing, altitude];
          }),
          custom: () => args.custom_offsets || [],
        };
        
        const offsets = formations[args.formation]?.() || formations.line();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              formation: args.formation,
              offsets: offsets,
              drones: DRONES.map((id, i) => ({ id, target: offsets[i] })),
              note: "Formation calculated. Execute by sending goto commands to each drone.",
            }, null, 2),
          }],
        };
      }

      case "swarm_search": {
        addEvent("command", `Search: ${args.pattern || "grid"} pattern`);
        
        const area = args.area || {};
        const altitude = args.altitude_m || 15;
        const swath = args.swath_width_m || 10;
        const cx = area.center?.[0] || 0;
        const cy = area.center?.[1] || 0;
        const width = area.width || 50;
        const height = area.height || 50;
        
        let waypoints = [];
        const pattern = args.pattern || "grid";
        
        if (pattern === "grid") {
          let dir = 1;
          for (let y = cy - height/2; y <= cy + height/2; y += swath) {
            if (dir === 1) {
              waypoints.push([cx - width/2, y, altitude]);
              waypoints.push([cx + width/2, y, altitude]);
            } else {
              waypoints.push([cx + width/2, y, altitude]);
              waypoints.push([cx - width/2, y, altitude]);
            }
            dir *= -1;
          }
        }
        
        const missionId = `search_${Date.now()}`;
        activeMissions[missionId] = {
          type: "search",
          pattern: pattern,
          waypoints: waypoints.length,
          progress: 0,
          started: new Date().toISOString(),
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              mission_id: missionId,
              pattern: pattern,
              waypoints: waypoints.length,
              waypoints_sample: waypoints.slice(0, 4),
            }, null, 2),
          }],
        };
      }

      case "behavior_create": {
        const behavior = {
          name: args.name,
          description: args.description,
          type: args.type || "custom",
          params: args.params || {},
          stats: { uses: 0, successes: 0, failures: 0, notes: [] },
          created: new Date().toISOString(),
        };
        
        if (args.based_on) {
          const base = loadBehavior(args.based_on);
          if (base) {
            Object.assign(behavior, base, { name: args.name, description: args.description });
          }
        }
        
        saveBehavior(behavior);
        addEvent("behavior", `Created behavior: ${args.name}`);
        
        return { content: [{ type: "text", text: `Behavior '${args.name}' created.` }] };
      }

      case "behavior_update": {
        const behavior = loadBehavior(args.name);
        if (!behavior) {
          return { content: [{ type: "text", text: `Behavior '${args.name}' not found.` }] };
        }
        
        behavior.stats = behavior.stats || { uses: 0, successes: 0, failures: 0, notes: [] };
        behavior.stats.uses++;
        if (args.success !== undefined) {
          args.success ? behavior.stats.successes++ : behavior.stats.failures++;
        }
        if (args.note) {
          behavior.stats.notes.push({ date: new Date().toISOString().split("T")[0], note: args.note });
        }
        
        saveBehavior(behavior);
        
        return { content: [{ type: "text", text: JSON.stringify(behavior.stats, null, 2) }] };
      }

      case "drone_status": {
        const drones = args.drone_ids?.join(",") || DRONES.join(",");
        addEvent("query", `Status query: ${drones}`);
        const result = await execInContainer("cmd_query.py", { drones });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    addEvent("error", `Tool ${name} failed: ${error.message}`);
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// ═══════════════════════════════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════════════════════════════

async function main() {
  if (!existsSync(BEHAVIORS_DIR)) mkdirSync(BEHAVIORS_DIR, { recursive: true });
  if (!existsSync(SCRIPTS_DIR)) mkdirSync(SCRIPTS_DIR, { recursive: true });
  
  if (!existsSync(join(BEHAVIORS_DIR, "_index.json"))) {
    saveBehaviorIndex({ version: 1, behaviors: [] });
  }
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("AutoM8te MCP Server running");
}

main().catch(console.error);
