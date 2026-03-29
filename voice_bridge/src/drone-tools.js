/**
 * AutoM8te Voice Bridge — Drone Tool Definitions & Executor
 *
 * Uses the consolidated /api/* endpoints from the Swarm Manager.
 * These are smarter and more capable than individual /tools/* routes.
 * Fewer tools = faster function calling = lower latency.
 *
 * Also includes ask_openclaw escape hatch for complex reasoning.
 */

import { config } from './config.js';

const BASE = config.swarmManager.url;

// ── Tool Definitions (OpenAI Realtime function calling format) ──

export const DRONE_TOOLS = [
  {
    type: 'function',
    name: 'drone_command',
    description: 'Execute a single-drone command. Actions: takeoff, land, hover, set_yaw, change_speed, change_altitude, return_home, emergency_stop, pause, resume.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (e.g. drone_1). Default: drone_1' },
        action: { type: 'string', description: 'Command: takeoff, land, hover, set_yaw, change_speed, change_altitude, return_home, emergency_stop, pause, resume' },
        altitude_m: { type: 'number', description: 'Target altitude in meters (for takeoff, change_altitude)' },
        heading_deg: { type: 'number', description: 'Target heading in degrees (for set_yaw)' },
        speed_m_s: { type: 'number', description: 'Target speed in m/s (for change_speed)' },
      },
      required: ['drone_id', 'action'],
    },
  },
  {
    type: 'function',
    name: 'drone_move',
    description: 'Move a drone: simple goto (lat/lon/alt), named path (s_curve, zigzag, arc, spiral, figure_eight, racetrack, ellipse, straight), or custom waypoints. Supports easing and looping.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
        target: { type: 'object', description: 'Simple goto: {lat, lon, alt_m, heading_deg}' },
        path: { type: 'string', description: 'Named path: s_curve, zigzag, arc, spiral, figure_eight, racetrack, ellipse, straight' },
        path_params: { type: 'object', description: 'Path generator params (varies by type)' },
        easing: { type: 'string', description: 'Easing: ease_in_out, linear, elastic, spring' },
        duration_s: { type: 'number', description: 'Flight duration in seconds' },
        loop: { type: 'boolean', description: 'Loop the path continuously' },
      },
      required: ['drone_id'],
    },
  },
  {
    type: 'function',
    name: 'drone_query',
    description: 'Get telemetry for a specific drone or all drones. Returns position, altitude, battery, mode, speed, heading.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all drones.' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_swarm',
    description: 'Fan any single-drone command to ALL drones or a subset. Use for "all drones take off", "everyone land", etc.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Command to fan out: takeoff, land, return_home, hover, emergency_stop' },
        altitude_m: { type: 'number', description: 'Altitude in meters (for takeoff)' },
        drone_ids: { type: 'array', items: { type: 'string' }, description: 'Target drone IDs. Omit for all.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'drone_formation',
    description: 'Arrange drones into a formation. Types: line, v, vee, circle, ring, grid, square, stack, column. Can also do animated transitions between formations.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Formation: line, v, vee, circle, ring, grid, square, stack, column' },
        spacing_m: { type: 'number', description: 'Spacing between drones in meters (default 10)' },
        alt_m: { type: 'number', description: 'Formation altitude in meters (default 10)' },
        heading_deg: { type: 'number', description: 'Formation heading (default 0 = north)' },
        transition_to: { type: 'string', description: 'Target formation for animated transition' },
        easing: { type: 'string', description: 'Easing for transitions' },
        duration_s: { type: 'number', description: 'Transition duration in seconds' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_search',
    description: 'Search an area with one drone or the whole swarm. Patterns: grid (lawnmower), spiral (inward), expanding (SAR).',
    parameters: {
      type: 'object',
      properties: {
        area: { type: 'object', description: 'Search bounds: {min_lat, min_lon, max_lat, max_lon}' },
        drone_id: { type: 'string', description: 'Drone ID. Omit for swarm search.' },
        pattern: { type: 'string', description: 'Pattern: grid, spiral, expanding' },
        alt_m: { type: 'number', description: 'Search altitude in meters (default 20)' },
      },
      required: ['area'],
    },
  },
  {
    type: 'function',
    name: 'drone_stop',
    description: 'Stop drone activity: paths, transitions, or everything. Omit drone_id to stop all drones.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all.' },
        what: { type: 'string', description: 'What to stop: path, transition, all (default: all)' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_status',
    description: 'Get full system status: all drones, capabilities, running tasks. No parameters needed.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'ask_openclaw',
    description: 'Delegate a complex request to the full AutoM8te AI agent (Claude Opus). Use for: multi-step planning, code generation, memory search, analysis, or anything beyond direct drone commands. Response may take 5-10 seconds.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The request or question to send to the full AI agent' },
      },
      required: ['message'],
    },
  },
];


// ── Tool Routing ───────────────────────────────────────────

const TOOL_ROUTES = {
  drone_command:   { method: 'POST', path: '/api/command' },
  drone_move:      { method: 'POST', path: '/api/move' },
  drone_query:     { method: 'POST', path: '/api/query' },
  drone_swarm:     { method: 'POST', path: '/api/swarm' },
  drone_formation: { method: 'POST', path: '/api/formation' },
  drone_search:    { method: 'POST', path: '/api/search' },
  drone_stop:      { method: 'POST', path: '/api/stop' },
  drone_status:    { method: 'GET',  path: '/api/status' },
};


// ── Tool Execution ─────────────────────────────────────────

/**
 * Execute a drone tool by calling the Swarm Manager HTTP API.
 * Special handling for ask_openclaw which goes to OpenClaw gateway.
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Parsed arguments from the Realtime API
 * @returns {Promise<string>} JSON string result for the Realtime API
 */
export async function executeTool(toolName, args) {
  // Special case: ask_openclaw goes to OpenClaw, not swarm manager
  if (toolName === 'ask_openclaw') {
    return executeAskOpenClaw(args.message || '');
  }

  const route = TOOL_ROUTES[toolName];
  if (!route) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  const url = `${BASE}${route.path}`;
  const startMs = Date.now();

  // Re-nest flat params into the structure the swarm manager expects
  let body = args;
  if (toolName === 'drone_command') {
    const { drone_id, action, altitude_m, heading_deg, speed_m_s, alt_m, ...rest } = args;
    const params = {};
    if (altitude_m !== undefined) params.altitude_m = altitude_m;
    if (heading_deg !== undefined) params.heading_deg = heading_deg;
    if (speed_m_s !== undefined) params.speed_m_s = speed_m_s;
    if (alt_m !== undefined) params.alt_m = alt_m;
    body = { drone_id, action, params: { ...params, ...rest } };
  } else if (toolName === 'drone_swarm') {
    const { action, drone_ids, altitude_m, ...rest } = args;
    const params = {};
    if (altitude_m !== undefined) params.altitude_m = altitude_m;
    body = { action, drone_ids, params: { ...params, ...rest } };
  }

  try {
    const fetchOpts = { method: route.method, headers: {} };
    if (route.method === 'POST') {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(body);
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


/**
 * Execute ask_openclaw: send a message to the OpenClaw autom8te agent.
 * Uses the OpenClaw gateway REST API if available, otherwise returns a fallback.
 * @param {string} message - The message to send
 * @returns {Promise<string>} JSON string result
 */
async function executeAskOpenClaw(message) {
  const startMs = Date.now();
  console.log(`🧠 ask_openclaw: "${message.substring(0, 100)}..."`);

  // Try the OpenClaw gateway API
  // The gateway URL and token can be configured via env vars
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:3284';
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

  try {
    const resp = await fetch(`${gatewayUrl}/api/v1/sessions/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(gatewayToken ? { 'Authorization': `Bearer ${gatewayToken}` } : {}),
      },
      body: JSON.stringify({
        label: 'autom8te',
        message: `[Voice Bridge Request] ${message}`,
        timeoutSeconds: 30,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const elapsed = Date.now() - startMs;
      console.log(`   ↳ OpenClaw responded in ${elapsed}ms`);
      return JSON.stringify({ response: data.response || data.message || JSON.stringify(data) });
    }

    // Fallback: gateway responded but with error
    const text = await resp.text();
    console.warn(`⚠️  OpenClaw gateway error: ${resp.status} - ${text.substring(0, 200)}`);
    return JSON.stringify({
      response: `I can't reach the full AI agent right now (HTTP ${resp.status}). Let me answer from what I know about the drone swarm. What specifically do you need?`,
    });
  } catch (err) {
    const elapsed = Date.now() - startMs;
    console.warn(`⚠️  ask_openclaw failed in ${elapsed}ms: ${err.message}`);
    return JSON.stringify({
      response: `The full AI agent isn't reachable right now. I can still control drones directly. What would you like me to do?`,
    });
  }
}
