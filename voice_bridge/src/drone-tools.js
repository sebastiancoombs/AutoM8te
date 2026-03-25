/**
 * AutoM8te Voice Bridge — Drone Tool Definitions & Executor
 *
 * Defines the tools that get registered with the OpenAI Realtime API session,
 * and handles executing them against the Swarm Manager HTTP API.
 */

import { config } from './config.js';

const BASE = config.swarmManager.url;

// ── Tool Definitions (OpenAI function calling format) ──────

export const DRONE_TOOLS = [
  {
    type: 'function',
    name: 'drone_takeoff',
    description: 'Take off a drone to specified altitude. Default drone is drone_1, default altitude is 10 meters.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (e.g. drone_1)', default: 'drone_1' },
        altitude_m: { type: 'number', description: 'Target altitude in meters (1-120)', default: 10 },
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
    description: 'Get telemetry/status for a specific drone (position, altitude, battery, state).',
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
    name: 'list_drones',
    description: 'List all registered drones with their current telemetry. No parameters needed.',
    parameters: {
      type: 'object',
      properties: {},
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
        spacing_m: { type: 'number', description: 'Spacing between drones in meters', default: 10 },
        alt_m: { type: 'number', description: 'Formation altitude in meters', default: 10 },
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
        lat: { type: 'number', description: 'Latitude' },
        lon: { type: 'number', description: 'Longitude' },
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
    description: 'Send command to ALL drones. Commands: takeoff, land, return_home, emergency_stop.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to broadcast (takeoff, land, return_home, emergency_stop)' },
        altitude_m: { type: 'number', description: 'Altitude for takeoff command', default: 10 },
      },
      required: ['command'],
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
        radius_m: { type: 'number', description: 'Orbit radius in meters', default: 20 },
        alt_m: { type: 'number', description: 'Orbit altitude', default: 10 },
      },
      required: ['drone_id', 'center_lat', 'center_lon'],
    },
  },
  {
    type: 'function',
    name: 'drone_hover',
    description: 'Hold a drone at its current position (stop all movement).',
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
    name: 'drone_emergency_stop',
    description: 'EMERGENCY: Immediately stop all motors on a drone. USE WITH CAUTION.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
      },
      required: ['drone_id'],
    },
  },
];


// ── Tool Execution ─────────────────────────────────────────

/**
 * Mapping from tool name to HTTP method + URL path.
 */
const TOOL_ROUTES = {
  drone_takeoff:        { method: 'POST', path: '/tools/drone_takeoff' },
  drone_land:           { method: 'POST', path: '/tools/drone_land' },
  drone_query:          { method: 'POST', path: '/tools/drone_query' },
  list_drones:          { method: 'GET',  path: '/drones' },
  drone_return_home:    { method: 'POST', path: '/tools/drone_return_home' },
  drone_formation:      { method: 'POST', path: '/tools/drone_formation' },
  drone_goto:           { method: 'POST', path: '/tools/drone_goto' },
  drone_velocity:       { method: 'POST', path: '/tools/drone_velocity' },
  drone_broadcast:      { method: 'POST', path: '/tools/drone_broadcast' },
  drone_orbit:          { method: 'POST', path: '/tools/drone_orbit' },
  drone_hover:          { method: 'POST', path: '/tools/drone_hover' },
  drone_emergency_stop: { method: 'POST', path: '/tools/drone_emergency_stop' },
};

/**
 * Execute a drone tool by calling the Swarm Manager HTTP API.
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Parsed arguments from the Realtime API
 * @returns {Promise<string>} JSON string result for the Realtime API
 */
export async function executeTool(toolName, args) {
  const route = TOOL_ROUTES[toolName];
  if (!route) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  const url = `${BASE}${route.path}`;
  const startMs = Date.now();

  try {
    const fetchOpts = { method: route.method, headers: {} };
    if (route.method === 'POST') {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(args);
    }

    const resp = await fetch(url, fetchOpts);
    const data = await resp.json();
    const elapsed = Date.now() - startMs;

    if (config.debug) {
      console.log(`🔧 ${toolName}(${JSON.stringify(args)}) → ${resp.status} in ${elapsed}ms`);
    }

    if (!resp.ok) {
      return JSON.stringify({ error: data.detail || data.message || `HTTP ${resp.status}`, status: resp.status });
    }

    return JSON.stringify(data);
  } catch (err) {
    console.error(`❌ Tool execution failed: ${toolName}`, err.message);
    return JSON.stringify({ error: err.message });
  }
}
