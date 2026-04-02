/**
 * AutoM8te Voice Bridge — Tool Definitions & Execution
 * 
 * Maps voice commands to intent-layer API calls.
 * The Realtime model calls these as functions; we proxy to the intent layer.
 */

import { config } from './config.js';

// Tool definitions for OpenAI Realtime session.update
export const toolDefinitions = [
  {
    type: 'function',
    name: 'drone_takeoff',
    description: 'Take off one or all drones to a specified altitude. Default altitude is 10m.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (e.g. "drone_0"). Omit for all drones.' },
        altitude_m: { type: 'number', description: 'Takeoff altitude in meters. Default: 10' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_land',
    description: 'Land one or all drones.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all drones.' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_hover',
    description: 'Hold position (hover) for one or all drones.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all drones.' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_return_home',
    description: 'Return one or all drones to their launch position.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all drones.' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_emergency',
    description: 'Emergency stop. Kills motors immediately. Use only in emergencies.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID for emergency stop.' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_move',
    description: 'Move drone(s) in a direction by a distance. Directions: north, south, east, west, up, down, forward, back, left, right.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID. Omit for all.' },
        group: { type: 'string', description: 'Group name. Omit to target individual or all.' },
        direction: {
          type: 'string',
          enum: ['north', 'south', 'east', 'west', 'up', 'down', 'forward', 'back', 'left', 'right'],
          description: 'Movement direction',
        },
        distance_m: { type: 'number', description: 'Distance in meters' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'], description: 'Speed preset. Default: normal' },
      },
      required: ['direction', 'distance_m'],
    },
  },
  {
    type: 'function',
    name: 'drone_formation',
    description: 'Arrange drones into a formation shape. Shapes: line, v, circle, ring, square, grid, column, echelon.',
    parameters: {
      type: 'object',
      properties: {
        shape: {
          type: 'string',
          description: 'Formation shape name',
        },
        spacing_m: { type: 'number', description: 'Spacing between drones in meters. Default: 5' },
        group: { type: 'string', description: 'Target group name. Omit for all drones.' },
        modifier: { type: 'string', description: 'Movement modifier: snake, wave, pulse, breathe, orbit, weave' },
      },
      required: ['shape'],
    },
  },
  {
    type: 'function',
    name: 'drone_search',
    description: 'Execute a search pattern over an area. Patterns: grid, lawnmower, spiral, expanding_square, sector, parallel.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          enum: ['grid', 'lawnmower', 'spiral', 'expanding_square', 'sector', 'parallel'],
          description: 'Search pattern',
        },
        width_m: { type: 'number', description: 'Search area width. Default: 50' },
        height_m: { type: 'number', description: 'Search area height. Default: 50' },
        altitude_m: { type: 'number', description: 'Search altitude. Default: 10' },
        group: { type: 'string', description: 'Target group' },
      },
      required: ['pattern'],
    },
  },
  {
    type: 'function',
    name: 'drone_status',
    description: 'Get status of all drones or a specific drone. Returns positions, battery, flight status.',
    parameters: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Specific drone to query. Omit for all.' },
      },
    },
  },
  {
    type: 'function',
    name: 'drone_group_assign',
    description: 'Assign drones to a named group for coordinated control.',
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Group name' },
        drones: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of drone IDs to assign',
        },
      },
      required: ['group', 'drones'],
    },
  },
];

/**
 * Execute a tool call by mapping it to the intent layer API.
 */
export async function executeTool(name, argsJson) {
  const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
  const url = config.intentLayer.url;

  try {
    // Map voice bridge tool names to intent layer tool names + args
    let intentName, intentArgs;

    switch (name) {
      case 'drone_takeoff':
        intentName = 'drone_command';
        intentArgs = { action: 'takeoff', altitude_m: args.altitude_m || 10, drone_id: args.drone_id };
        break;
      case 'drone_land':
        intentName = 'drone_command';
        intentArgs = { action: 'land', drone_id: args.drone_id };
        break;
      case 'drone_hover':
        intentName = 'drone_command';
        intentArgs = { action: 'hover', drone_id: args.drone_id };
        break;
      case 'drone_return_home':
        intentName = 'drone_command';
        intentArgs = { action: 'rtl', drone_id: args.drone_id };
        break;
      case 'drone_emergency':
        intentName = 'drone_command';
        intentArgs = { action: 'emergency', drone_id: args.drone_id };
        break;
      case 'drone_move':
        intentName = 'drone_move';
        intentArgs = args;
        break;
      case 'drone_formation':
        intentName = 'drone_formation';
        intentArgs = args;
        break;
      case 'drone_search':
        intentName = 'drone_search';
        intentArgs = args;
        break;
      case 'drone_status':
        intentName = 'drone_query';
        intentArgs = { what: 'status', drone_id: args.drone_id };
        break;
      case 'drone_group_assign':
        intentName = 'drone_group';
        intentArgs = { action: 'assign', group: args.group, drones: args.drones };
        break;
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    // Clean undefined values
    Object.keys(intentArgs).forEach(k => intentArgs[k] === undefined && delete intentArgs[k]);

    const res = await fetch(`${url}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: intentName, args: intentArgs }),
    });

    const data = await res.json();
    // Return a concise version for the voice model
    if (data.result) return JSON.stringify({ ok: true, result: data.result });
    if (data.error) return JSON.stringify({ ok: false, error: data.error });
    return JSON.stringify(data);
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Intent layer error: ${err.message}` });
  }
}
