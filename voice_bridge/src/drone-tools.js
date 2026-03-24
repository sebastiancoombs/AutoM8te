/**
 * Drone tool definitions for OpenAI Realtime API function calling.
 * Each tool maps to a Swarm Manager HTTP endpoint.
 */

const SWARM_URL = process.env.SWARM_MANAGER_URL || 'http://localhost:8000';

// ── Tool Definitions (sent to Realtime API in session.update) ──

export const DRONE_TOOLS = [
  {
    type: 'function',
    name: 'drone_takeoff',
    description: 'Take off a drone to specified altitude. Default drone is drone_1, default altitude is 10 meters.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (e.g. drone_1)' },
        altitude_m: { type: 'number', description: 'Target altitude in meters (1-120)' },
      },
      required: ['drone_id'],
    },
  },
  {
    type: 'function',
    name: 'drone_land',
    description: 'Land a drone at its current position.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
      },
      required: ['drone_id'],
    },
  },
  {
    type: 'function',
    name: 'drone_query',
    description: 'Get telemetry/status for a drone (position, altitude, battery, state).',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
      },
      required: ['drone_id'],
    },
  },
  {
    type: 'function',
    name: 'drone_return_home',
    description: 'Return a drone to its launch position and land.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
      },
      required: ['drone_id'],
    },
  },
  {
    type: 'function',
    name: 'drone_formation',
    description: 'Command all drones into a formation. Types: line, v, circle, grid, stack.',
    parameters: {
      type: 'object',
      properties: {
        formation: { type: 'string', description: 'Formation type (line, v, circle, grid, stack)' },
        spacing_m: { type: 'number', description: 'Spacing between drones in meters' },
        alt_m: { type: 'number', description: 'Formation altitude in meters' },
        heading_deg: { type: 'number', description: 'Formation heading (0=N, 90=E)' },
      },
      required: ['formation'],
    },
  },
  {
    type: 'function',
    name: 'drone_goto',
    description: 'Fly a drone to GPS coordinates.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
        lat: { type: 'number', description: 'Latitude in degrees' },
        lon: { type: 'number', description: 'Longitude in degrees' },
        alt_m: { type: 'number', description: 'Altitude in meters' },
      },
      required: ['drone_id', 'lat', 'lon', 'alt_m'],
    },
  },
  {
    type: 'function',
    name: 'drone_velocity',
    description: 'Set velocity vector for a drone (NED frame). Negative vz = climb.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
        vx_ms: { type: 'number', description: 'North velocity m/s' },
        vy_ms: { type: 'number', description: 'East velocity m/s' },
        vz_ms: { type: 'number', description: 'Down velocity m/s (negative=climb)' },
      },
      required: ['drone_id', 'vx_ms', 'vy_ms', 'vz_ms'],
    },
  },
  {
    type: 'function',
    name: 'drone_broadcast',
    description: 'Send a command to ALL drones. Commands: takeoff, land, return_home, emergency_stop.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to broadcast' },
        altitude_m: { type: 'number', description: 'Altitude for takeoff command' },
      },
      required: ['command'],
    },
  },
  {
    type: 'function',
    name: 'list_drones',
    description: 'List all registered drones with their current telemetry.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'drone_orbit',
    description: 'Orbit a drone around a GPS point.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
        center_lat: { type: 'number', description: 'Center latitude' },
        center_lon: { type: 'number', description: 'Center longitude' },
        radius_m: { type: 'number', description: 'Orbit radius in meters' },
        alt_m: { type: 'number', description: 'Orbit altitude in meters' },
        clockwise: { type: 'boolean', description: 'Orbit direction' },
      },
      required: ['drone_id', 'center_lat', 'center_lon'],
    },
  },
  {
    type: 'function',
    name: 'drone_search',
    description: 'Search an area with a drone using grid, spiral, or expanding pattern.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
        min_lat: { type: 'number', description: 'South boundary' },
        min_lon: { type: 'number', description: 'West boundary' },
        max_lat: { type: 'number', description: 'North boundary' },
        max_lon: { type: 'number', description: 'East boundary' },
        alt_m: { type: 'number', description: 'Search altitude' },
        pattern: { type: 'string', description: 'Pattern: grid, spiral, expanding' },
      },
      required: ['drone_id', 'min_lat', 'min_lon', 'max_lat', 'max_lon'],
    },
  },
];

// ── Tool Execution (HTTP calls to Swarm Manager) ──

const TOOL_ENDPOINTS = {
  drone_takeoff:     { method: 'POST', path: '/tools/drone_takeoff' },
  drone_land:        { method: 'POST', path: '/tools/drone_land' },
  drone_query:       { method: 'POST', path: '/tools/drone_query' },
  drone_return_home: { method: 'POST', path: '/tools/drone_return_home' },
  drone_formation:   { method: 'POST', path: '/tools/drone_formation' },
  drone_goto:        { method: 'POST', path: '/tools/drone_goto' },
  drone_velocity:    { method: 'POST', path: '/tools/drone_velocity' },
  drone_broadcast:   { method: 'POST', path: '/tools/drone_broadcast' },
  drone_orbit:       { method: 'POST', path: '/tools/drone_orbit' },
  drone_search:      { method: 'POST', path: '/tools/drone_search' },
  list_drones:       { method: 'GET',  path: '/drones' },
};

/**
 * Execute a drone tool by calling the Swarm Manager HTTP API.
 * @param {string} toolName - Function name from Realtime API
 * @param {object} args - Parsed arguments from the model
 * @returns {Promise<string>} JSON string result
 */
export async function executeTool(toolName, args) {
  const endpoint = TOOL_ENDPOINTS[toolName];
  if (!endpoint) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  const url = `${SWARM_URL}${endpoint.path}`;
  console.log(`[TOOL] ${toolName}(${JSON.stringify(args)}) -> ${endpoint.method} ${url}`);

  try {
    const opts = {
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (endpoint.method === 'POST') {
      // Apply defaults
      if (toolName === 'drone_takeoff' && !args.altitude_m) args.altitude_m = 10;
      opts.body = JSON.stringify(args);
    }

    const res = await fetch(url, opts);
    const data = await res.json();
    console.log(`[TOOL] ${toolName} -> ${res.status}`, JSON.stringify(data).slice(0, 200));
    return JSON.stringify(data);
  } catch (err) {
    console.error(`[TOOL] ${toolName} FAILED:`, err.message);
    return JSON.stringify({ error: err.message });
  }
}
