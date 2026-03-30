#!/usr/bin/env node
/**
 * AutoM8te Intent Layer — MCP Server
 * 
 * Intent-based drone swarm control.
 * LLM speaks in directions/shapes/patterns, we translate to coordinates.
 */

import { createInterface } from 'readline';
import { resolveDirection, resolveSpeed, scaleVector } from './lookups/directions.js';
import { resolveFormation } from './lookups/formations.js';
import { resolvePattern } from './lookups/patterns.js';
import { 
  defineModifier, 
  getModifier, 
  listModifiers, 
  applyModifierToFormation,
  PATTERN_TYPES,
  AXIS_TYPES,
  TIMING_TYPES,
} from './lookups/modifiers.js';
import { MockAdapter } from './adapters/mock.js';
import { Aerostack2Adapter } from './adapters/aerostack2.js';
import { PyBulletAdapter } from './adapters/pybullet.js';

// --- Configuration ---

const BACKEND = process.env.AUTOM8TE_BACKEND || 'mock';
const DRONE_COUNT = parseInt(process.env.AUTOM8TE_DRONES || '4', 10);
const GUI = process.env.AUTOM8TE_GUI === 'true';

// --- Backend Selection ---

let backend;
switch (BACKEND) {
  case 'aerostack2':
    backend = new Aerostack2Adapter({ droneCount: DRONE_COUNT });
    break;
  case 'pybullet':
    backend = new PyBulletAdapter({ droneCount: DRONE_COUNT, gui: GUI });
    break;
  case 'mock':
  default:
    backend = new MockAdapter(DRONE_COUNT);
}

// --- MCP Protocol Handlers ---

const tools = [
  {
    name: 'takeoff',
    description: 'Take off drones to specified altitude',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for all)' },
        altitude_m: { type: 'number', description: 'Target altitude in meters (default: 5)' },
        speed: { type: 'string', description: 'Speed preset: slow, normal, fast (default: normal)' },
      },
    },
  },
  {
    name: 'land',
    description: 'Land drones',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for all)' },
        speed: { type: 'string', description: 'Speed preset: slow, normal (default: slow)' },
      },
    },
  },
  {
    name: 'move',
    description: 'Move drone(s) in a direction. Use forward/back/left/right for body-relative, or north/south/east/west for earth-fixed.',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for all)' },
        direction: { 
          type: 'string', 
          enum: ['forward', 'back', 'backward', 'left', 'right', 'up', 'down', 'north', 'south', 'east', 'west'],
          description: 'Movement direction',
        },
        distance_m: { type: 'number', description: 'Distance in meters' },
        speed: { type: 'string', description: 'Speed preset: slow, normal, fast' },
      },
      required: ['direction', 'distance_m'],
    },
  },
  {
    name: 'stop',
    description: 'Stop movement immediately. Drone holds current position, others continue.',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone to stop (omit for all)' },
      },
    },
  },
  {
    name: 'rtl',
    description: 'Return to launch position',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for all)' },
      },
    },
  },
  {
    name: 'emergency',
    description: 'Emergency stop - land immediately',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for all)' },
      },
    },
  },
  {
    name: 'form',
    description: 'Arrange swarm into a formation, optionally with a movement modifier',
    inputSchema: {
      type: 'object',
      properties: {
        shape: {
          type: 'string',
          enum: ['line', 'v', 'circle', 'ring', 'square', 'grid', 'column', 'file', 'echelon'],
          description: 'Formation shape',
        },
        spacing_m: { type: 'number', description: 'Spacing between drones in meters (default: 5)' },
        modifier: { 
          type: 'string', 
          description: 'Movement modifier to apply (e.g., snake, wave, pulse, breathe, orbit, weave)' 
        },
      },
      required: ['shape'],
    },
  },
  {
    name: 'define_modifier',
    description: 'Create a new movement modifier using building blocks. The modifier can then be used with form() or follow().',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for this modifier' },
        pattern: {
          type: 'string',
          enum: ['sinusoidal', 'linear', 'circular', 'pulse', 'sawtooth', 'triangle', 'random'],
          description: 'Base movement pattern',
        },
        axis: {
          type: 'string',
          enum: ['lateral', 'vertical', 'forward', 'all'],
          description: 'Which axis the movement applies to',
        },
        amplitude_m: { type: 'number', description: 'Movement amplitude in meters (default: 1)' },
        frequency_hz: { type: 'number', description: 'Oscillation frequency in Hz (default: 0.5)' },
        timing: {
          type: 'string',
          enum: ['sync', 'staggered', 'reverse_stagger', 'center_out', 'random', 'sequential'],
          description: 'How drones are timed relative to each other',
        },
        phase_offset: { type: 'number', description: 'Phase offset between drones for staggered timing (default: 0.5)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_modifiers',
    description: 'List all available movement modifiers',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search',
    description: 'Execute a search pattern over an area',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          enum: ['grid', 'lawnmower', 'spiral', 'expanding', 'expanding_square', 'sector', 'parallel'],
          description: 'Search pattern type',
        },
        width_m: { type: 'number', description: 'Search area width (default: 50)' },
        height_m: { type: 'number', description: 'Search area height (default: 50)' },
        spacing_m: { type: 'number', description: 'Track spacing (default: 10)' },
        altitude_m: { type: 'number', description: 'Search altitude (default: 10)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'follow',
    description: '[Phase 3] Follow a tracked object. Requires perception system.',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID' },
        target: { type: 'string', description: 'Target to follow (e.g., "person", "vehicle", object ID)' },
      },
      required: ['target'],
    },
  },
  {
    name: 'status',
    description: 'Get human-readable swarm status summary',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// --- Tool Execution ---

async function executeTool(name, args) {
  const droneIds = args.drone_id 
    ? [args.drone_id]
    : [...(await backend.getDroneStates()).keys()];

  switch (name) {
    case 'takeoff': {
      const altitude = args.altitude_m || 5;
      const speed = resolveSpeed(args.speed || 'normal');
      // Parallel: fire all, wait for all
      await Promise.all(droneIds.map(id => backend.takeoff(id, altitude, speed)));
      return `${droneIds.length} drone(s) taking off to ${altitude}m`;
    }

    case 'land': {
      const speed = resolveSpeed(args.speed || 'slow');
      await Promise.all(droneIds.map(id => backend.land(id, speed)));
      return `${droneIds.length} drone(s) landing`;
    }

    case 'move': {
      const { vector, frame } = resolveDirection(args.direction);
      const scaled = scaleVector(vector, args.distance_m);
      const speed = resolveSpeed(args.speed || 'normal');
      
      // Fire-and-forget: drones move, tool returns immediately
      // Use stop() to interrupt
      Promise.all(droneIds.map(id => 
        backend.goTo(id, scaled[0], scaled[1], scaled[2], speed, frame)
      )).catch(err => console.error('[move] Error:', err));
      
      return `${droneIds.length} drone(s) moving ${args.direction} ${args.distance_m}m`;
    }

    case 'stop': {
      await Promise.all(droneIds.map(id => backend.hover(id)));
      return droneIds.length === 1 
        ? `${droneIds[0]} stopped`
        : `${droneIds.length} drone(s) stopped`;
    }

    case 'rtl': {
      await Promise.all(droneIds.map(id => backend.rtl(id)));
      return `${droneIds.length} drone(s) returning to launch`;
    }

    case 'emergency': {
      await backend.emergency(args.drone_id);
      return `EMERGENCY STOP executed`;
    }

    case 'form': {
      const count = await backend.getDroneCount();
      const spacing = args.spacing_m || 5;
      let offsets = resolveFormation(args.shape, count, spacing);
      
      // Apply modifier if specified
      if (args.modifier) {
        const mod = getModifier(args.modifier);
        if (!mod) {
          return `Unknown modifier: ${args.modifier}. Use list_modifiers to see available options.`;
        }
        // Apply at t=0 for initial formation, continuous updates happen in backend
        offsets = applyModifierToFormation(args.modifier, offsets, 0);
      }
      
      await backend.setFormation(offsets);
      
      const modifierNote = args.modifier ? ` with ${args.modifier} modifier` : '';
      return `Swarm forming ${args.shape}${modifierNote} with ${spacing}m spacing`;
    }

    case 'define_modifier': {
      const modifier = defineModifier(args);
      return `Modifier "${modifier.name}" defined: ${modifier.pattern} on ${modifier.axis} axis, ${modifier.amplitude_m}m amplitude, ${modifier.frequency_hz}Hz, ${modifier.timing} timing`;
    }

    case 'list_modifiers': {
      const mods = listModifiers();
      return `Available modifiers: ${mods.join(', ')}`;
    }

    case 'search': {
      const waypoints = resolvePattern(args.pattern, {
        width: args.width_m,
        height: args.height_m,
        spacing: args.spacing_m,
        altitude: args.altitude_m,
      });
      
      // Distribute waypoints across drones
      const states = await backend.getDroneStates();
      const ids = [...states.keys()];
      const waypointsPerDrone = Math.ceil(waypoints.length / ids.length);
      
      for (let i = 0; i < ids.length; i++) {
        const start = i * waypointsPerDrone;
        const droneWaypoints = waypoints.slice(start, start + waypointsPerDrone);
        if (droneWaypoints.length > 0) {
          await backend.followPath(ids[i], droneWaypoints, resolveSpeed('normal'));
        }
      }
      return `${args.pattern} search started, ${waypoints.length} waypoints across ${ids.length} drones`;
    }

    case 'follow': {
      const position = await backend.getObjectPosition(args.target);
      if (!position) {
        return `Cannot locate target "${args.target}". Perception system may not be available.`;
      }
      const id = args.drone_id || [...(await backend.getDroneStates()).keys()][0];
      await backend.followObject(id, args.target);
      return `${id} following ${args.target}`;
    }

    case 'status': {
      const state = await backend.getSwarmState();
      const lines = [];
      lines.push(`Swarm: ${state.count} drones, formation: ${state.formation}`);
      lines.push(`Centroid: [${state.centroid.map(v => v.toFixed(1)).join(', ')}]`);
      
      for (const [id, drone] of state.drones) {
        const pos = drone.position.map(v => v.toFixed(1)).join(', ');
        lines.push(`  ${id}: [${pos}] ${drone.status} battery:${drone.battery}%`);
      }
      return lines.join('\n');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP Server (stdio) ---

async function handleMessage(message) {
  const { id, method, params } = message;

  try {
    switch (method) {
      case 'initialize':
        await backend.connect();
        return {
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'autom8te-intent', version: '1.0.0' },
            capabilities: { tools: {} },
          },
        };

      case 'tools/list':
        return { id, result: { tools } };

      case 'tools/call': {
        const { name, arguments: args } = params;
        const result = await executeTool(name, args || {});
        return {
          id,
          result: {
            content: [{ type: 'text', text: result }],
          },
        };
      }

      case 'ping':
        return { id, result: {} };

      default:
        return { id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (error) {
    return { id, error: { code: -32000, message: error.message } };
  }
}

// --- Main ---

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  try {
    const message = JSON.parse(line);
    const response = await handleMessage(message);
    console.log(JSON.stringify(response));
  } catch (error) {
    console.log(JSON.stringify({
      error: { code: -32700, message: 'Parse error' },
    }));
  }
});

console.error(`[AutoM8te Intent Layer] Started with backend: ${BACKEND}`);
