// AutoM8te OpenClaw Plugin — 8 consolidated drone swarm tools
// Each tool hits the FastAPI Swarm Manager at localhost:8000/api/*

const BASE = "http://localhost:8000";

async function post(path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
}

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
}

export default {
  id: "autom8te",
  name: "AutoM8te Drone Swarm",
  description: "8 drone swarm control tools for the AutoM8te Swarm Manager",
  register(api) {
  // 1. command — single drone ops
  api.registerTool({
    name: "drone_command",
    label: "Drone Command",
    description:
      "Execute a single-drone command. Actions: takeoff, land, hover, set_yaw, change_speed, change_altitude, set_home, pause, resume, return_home, emergency_stop. Params: takeoff→altitude_m, set_yaw→heading_deg/relative/speed_degs, change_speed→speed_ms, change_altitude→alt_m.",
    parameters: {
      type: "object",
      properties: {
        drone_id: { type: "string", description: "Target drone ID (drone_1 through drone_5)" },
        action: { type: "string", description: "Command action" },
        params: { type: "object", description: "Action-specific parameters" },
      },
      required: ["drone_id", "action"],
    },
    async execute(_id, p) {
      return post("/api/command", { drone_id: p.drone_id, action: p.action, params: p.params || {} });
    },
  });

  // 2. move — move a drone along a path
  api.registerTool({
    name: "drone_move",
    label: "Drone Move",
    description:
      "Move a drone. target={north_m, east_m, alt_m} for goto. path=path_type name for named paths (s_curve, zigzag, arc, spiral, ellipse, figure_eight, racetrack, straight). easing=easing function name. duration_s=time. loop=bool.",
    parameters: {
      type: "object",
      properties: {
        drone_id: { type: "string", description: "Target drone ID" },
        target: { type: "object", description: "{north_m, east_m, alt_m} for simple goto" },
        path: { type: "string", description: "Named path type" },
        path_params: { type: "object", description: "Path-specific parameters" },
        waypoints: { type: "array", description: "Custom waypoint list [{north_m, east_m, alt_m}]" },
        easing: { type: "string", description: "Easing function name" },
        duration_s: { type: "number", description: "Duration in seconds" },
        loop: { type: "boolean", description: "Loop the path" },
      },
      required: ["drone_id"],
    },
    async execute(_id, p) {
      return post("/api/move", p);
    },
  });

  // 3. query — telemetry
  api.registerTool({
    name: "drone_query",
    label: "Drone Query",
    description:
      "Get drone telemetry. Omit drone_id to query all drones. Returns position, velocity, attitude, GPS, battery.",
    parameters: {
      type: "object",
      properties: {
        drone_id: { type: "string", description: "Target drone ID (omit for all)" },
      },
    },
    async execute(_id, p) {
      return post("/api/query", p);
    },
  });

  // 4. swarm — parallel multi-drone dispatch (O(1) via asyncio.gather)
  api.registerTool({
    name: "drone_swarm",
    label: "Drone Swarm",
    description:
      "Fan any command to all or a subset of drones in parallel (O(1) not O(n)). action=command name, params=command params, drone_ids=subset (omit for all), reference_drone=reference for relative commands.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Command to fan out" },
        params: { type: "object", description: "Command parameters" },
        drone_ids: { type: "array", description: "Subset of drone IDs (omit for all)", items: { type: "string" } },
        reference_drone: { type: "string", description: "Reference drone for relative commands" },
      },
      required: ["action"],
    },
    async execute(_id, p) {
      return post("/api/swarm", { action: p.action, params: p.params || {}, drone_ids: p.drone_ids, reference_drone: p.reference_drone });
    },
  });

  // 5. formation — formation control with transitions
  api.registerTool({
    name: "drone_formation",
    label: "Drone Formation",
    description:
      "Set formation: line, v, vee, circle, ring, grid, square, stack, column. Supports animated transitions with easing. spacing_m, alt_m, heading_deg, transforms (scale/rotate/translate), transition_to for animated change, easing, duration_s, stagger.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Formation name" },
        coordinates: { type: "array", description: "Custom NED coordinates [{north_m, east_m, alt_m}]" },
        spacing_m: { type: "number", description: "Spacing between drones in meters" },
        alt_m: { type: "number", description: "Formation altitude" },
        heading_deg: { type: "number", description: "Formation heading" },
        center_lat: { type: "number", description: "Center latitude" },
        center_lon: { type: "number", description: "Center longitude" },
        transforms: { type: "array", description: "Transform operations [{type, value}]" },
        transition_to: { type: "string", description: "Target formation for animated transition" },
        transition_coords: { type: "array", description: "Target coordinates for transition" },
        easing: { type: "string", description: "Easing function for transition" },
        duration_s: { type: "number", description: "Transition duration" },
        stagger: { type: "number", description: "Stagger delay between drones" },
      },
    },
    async execute(_id, p) {
      return post("/api/formation", p);
    },
  });

  // 6. search — search patterns
  api.registerTool({
    name: "drone_search",
    label: "Drone Search",
    description:
      "Search an area. Patterns: grid (lawnmower), spiral (inward), expanding_square (SAR). area={north_m, east_m, width_m, height_m}. drone_id for single, omit for swarm split.",
    parameters: {
      type: "object",
      properties: {
        area: { type: "object", description: "{north_m, east_m, width_m, height_m}" },
        drone_id: { type: "string", description: "Single drone (omit for swarm)" },
        pattern: { type: "string", description: "Search pattern name" },
        alt_m: { type: "number", description: "Search altitude" },
        swath_width_m: { type: "number", description: "Swath width for grid pattern" },
      },
    },
    async execute(_id, p) {
      return post("/api/search", p);
    },
  });

  // 7. stop — stop activity
  api.registerTool({
    name: "drone_stop",
    label: "Drone Stop",
    description:
      "Stop drone activity. what='paths'|'transitions'|'search'|'all'. drone_id for single drone, omit for all.",
    parameters: {
      type: "object",
      properties: {
        drone_id: { type: "string", description: "Target drone (omit for all)" },
        what: { type: "string", description: "What to stop: paths, transitions, search, all" },
      },
    },
    async execute(_id, p) {
      return post("/api/stop", p);
    },
  });

  // 8. status — system overview
  api.registerTool({
    name: "drone_status",
    label: "Drone Status",
    description:
      "Get full system status: all drones, positions, battery, running paths, transitions, capabilities.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_id, _p) {
      return get("/api/status");
    },
  });
},
};

