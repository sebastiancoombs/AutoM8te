#!/usr/bin/env node
/**
 * AutoM8te Intent Layer — MCP Server
 * 
 * 8 grouped tools for fast LLM function calling.
 * Rich context returned with every response.
 */

import { createInterface } from 'readline';
import { resolveDirection, resolveSpeed, scaleVector } from './lookups/directions.js';
import { resolveFormation } from './lookups/formations.js';
import { resolvePattern } from './lookups/patterns.js';
import { 
  defineModifier, getModifier, listModifiers, applyModifierToFormation,
} from './lookups/modifiers.js';
import { createShape, getShape, listShapes, deleteShape, resolveShape, resolveCurves } from './lookups/shapes.js';
import { MockDetector } from './perception/detector.js';
import { GroupManager } from './state/groups.js';
import { MockAdapter } from './adapters/mock.js';
import { Aerostack2Adapter } from './adapters/aerostack2.js';
import { PyBulletAdapter } from './adapters/pybullet.js';
import { ArduPilotAdapter } from './adapters/ardupilot.js';

// --- Configuration ---
const BACKEND = process.env.AUTOM8TE_BACKEND || 'mock';
const DRONE_COUNT = parseInt(process.env.AUTOM8TE_DRONES || '4', 10);
const GUI = process.env.AUTOM8TE_GUI === 'true';
const PERCEPTION = process.env.AUTOM8TE_PERCEPTION || 'mock';
const ARDUPILOT_PATH = process.env.ARDUPILOT_PATH || null;

// --- Perception ---
let detector;
if (PERCEPTION === 'yolo') {
  const { ObjectDetector } = await import('./perception/detector.js');
  detector = new ObjectDetector();
} else {
  detector = new MockDetector();
}

// --- Backend ---
let backend;
switch (BACKEND) {
  case 'webots':
    backend = new ArduPilotAdapter({ droneCount: DRONE_COUNT, backend: 'webots', ardupilotPath: ARDUPILOT_PATH });
    break;
  case 'ardupilot':
    backend = new ArduPilotAdapter({ droneCount: DRONE_COUNT });
    break;
  case 'aerostack2':
    backend = new Aerostack2Adapter({ droneCount: DRONE_COUNT });
    break;
  case 'pybullet':
    backend = new PyBulletAdapter({ droneCount: DRONE_COUNT, gui: GUI });
    break;
  default:
    backend = new MockAdapter(DRONE_COUNT);
}

// --- Group Manager ---
const groups = new GroupManager();

// --- (path planning delegated to backend adapters) ---

// --- 8 Grouped Tools ---
const tools = [
  {
    name: 'drone_command',
    description: 'Execute a flight command on one drone, a group, or all drones.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['takeoff', 'land', 'hover', 'rtl', 'emergency'], description: 'Flight command' },
        drone_id: { type: 'string', description: 'Target drone (omit for all)' },
        group: { type: 'string', description: 'Target group name' },
        altitude_m: { type: 'number', description: 'Altitude for takeoff (default: 5)' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'], description: 'Speed preset' },
      },
      required: ['action'],
    },
  },
  {
    name: 'drone_move',
    description: 'Move drone(s) in a direction. Body-relative: forward/back/left/right. Earth-fixed: north/south/east/west. Vertical: up/down.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['forward', 'back', 'left', 'right', 'up', 'down', 'north', 'south', 'east', 'west'], description: 'Movement direction' },
        distance_m: { type: 'number', description: 'Distance in meters' },
        drone_id: { type: 'string', description: 'Target drone (omit for all)' },
        group: { type: 'string', description: 'Target group name' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'], description: 'Speed preset' },
      },
      required: ['direction', 'distance_m'],
    },
  },
  {
    name: 'drone_formation',
    description: 'Arrange drones into a formation shape, optionally with a movement modifier.',
    inputSchema: {
      type: 'object',
      properties: {
        shape: { type: 'string', description: 'Formation shape. Built-in: line, v, circle, ring, square, grid, column, echelon. Also accepts any custom shape name from drone_choreograph.' },
        spacing_m: { type: 'number', description: 'Spacing in meters (default: 5)' },
        group: { type: 'string', description: 'Target group (omit for all)' },
        modifier: { type: 'string', description: 'Movement modifier: snake, wave, pulse, breathe, orbit, weave' },
      },
      required: ['shape'],
    },
  },
  {
    name: 'drone_search',
    description: 'Execute a search pattern over an area.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', enum: ['grid', 'lawnmower', 'spiral', 'expanding_square', 'sector', 'parallel'], description: 'Search pattern' },
        width_m: { type: 'number', description: 'Search area width (default: 50)' },
        height_m: { type: 'number', description: 'Search area height (default: 50)' },
        spacing_m: { type: 'number', description: 'Track spacing (default: 10)' },
        altitude_m: { type: 'number', description: 'Search altitude (default: 10)' },
        group: { type: 'string', description: 'Target group (omit for all)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'drone_follow',
    description: 'Follow a tracked object (person, car, truck, or object ID). Uses perception to locate and track.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target to follow (class name or object ID)' },
        distance_m: { type: 'number', description: 'Follow distance (default: 10)' },
        formation: { type: 'string', description: 'Formation while following (line, v, etc.)' },
        group: { type: 'string', description: 'Group to follow with' },
        modifier: { type: 'string', description: 'Movement modifier while following' },
      },
      required: ['target'],
    },
  },
  {
    name: 'drone_query',
    description: 'Get swarm status, detect objects, or locate a specific target. Returns full situational awareness.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['status', 'detect', 'locate'], description: 'What to query (default: status)' },
        target: { type: 'string', description: 'Object to locate (for locate query)' },
        drone_id: { type: 'string', description: 'Specific drone to query' },
        group: { type: 'string', description: 'Specific group to query' },
      },
    },
  },
  {
    name: 'drone_group',
    description: 'Manage drone groups: assign drones to groups, disband groups, or list all groups.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['assign', 'disband', 'list'], description: 'Group action' },
        drones: { type: 'array', items: { type: 'string' }, description: 'Drone IDs to assign' },
        group: { type: 'string', description: 'Group name' },
      },
      required: ['action'],
    },
  },
  {
    name: 'drone_choreograph',
    description: 'Create custom formations from math curves (parametric, polar, bezier, circle, arc, line). Saved shapes become reusable in drone_formation. Actions: create, list, delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'delete'], description: 'Choreograph action' },
        name: { type: 'string', description: 'Shape name (for create/delete)' },
        curves: {
          type: 'array',
          description: 'Array of curve objects. Each has "equation" (parametric/polar/bezier/circle/arc/line) plus type-specific params.',
          items: {
            type: 'object',
            properties: {
              equation: { type: 'string', enum: ['parametric', 'polar', 'circle', 'arc', 'line', 'bezier'] },
              x: { type: 'string', description: 'x(t) expression (parametric)' },
              y: { type: 'string', description: 'y(t) expression (parametric)' },
              r: { type: 'string', description: 'r(theta) expression (polar)' },
              t: { type: 'array', description: '[min, max] parameter range' },
              theta: { type: 'array', description: '[min, max] angle range (polar)' },
              radius: { type: 'number', description: 'Radius (circle/arc)' },
              center: { type: 'array', description: '[x, y] center point' },
              start_angle: { type: 'number', description: 'Start angle in degrees (arc)' },
              end_angle: { type: 'number', description: 'End angle in degrees (arc)' },
              start: { type: 'array', description: '[x, y] start point (line)' },
              end: { type: 'array', description: '[x, y] end point (line)' },
              points: { type: 'array', description: 'Control points [[x,y], ...] (bezier)' },
            },
            required: ['equation'],
          },
        },
        scale_m: { type: 'number', description: 'Scale factor in meters (default: 1)' },
        save: { type: 'boolean', description: 'Save for future use (default: true)' },
        duration_s: { type: 'number', description: 'Animation duration in seconds. If set, shape uses time variable and animates.' },
        easing: { type: 'string', description: 'Easing function: linear, inOut, in, out, elastic, bounce, cubic, expo (default: inOut)' },
        keyframes: {
          type: 'array',
          description: 'Array of shape keyframes for morphing animations. Each has "at" (0-1 normalized time) and "curves" (same format as top-level curves).',
          items: {
            type: 'object',
            properties: {
              at: { type: 'number', description: 'Time position 0-1 (0=start, 1=end)' },
              curves: { type: 'array', description: 'Curves at this keyframe (same format as top-level curves)' },
            },
            required: ['at', 'curves'],
          },
        },
        motion: {
          type: 'object',
          description: 'Motion path — moves the entire shape along a trajectory while maintaining formation.',
          properties: {
            path: { type: 'string', enum: ['circle', 'line', 'figure8'], description: 'Motion path type' },
            radius_m: { type: 'number', description: 'Radius for circle/figure8 (default: 20)' },
            distance_m: { type: 'number', description: 'Distance for line path' },
            direction: { type: 'string', description: 'Direction for line path (north/south/east/west)' },
            duration_s: { type: 'number', description: 'Time to complete one loop (default: 10)' },
            rotate_with_path: { type: 'boolean', description: 'Rotate shape to face direction of travel (default: true)' },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drone_modifier',
    description: 'Define a custom movement modifier or list available modifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['define', 'list'], description: 'Modifier action' },
        name: { type: 'string', description: 'Modifier name (for define)' },
        pattern: { type: 'string', enum: ['sinusoidal', 'linear', 'circular', 'pulse', 'sawtooth', 'triangle', 'random'], description: 'Base pattern' },
        axis: { type: 'string', enum: ['lateral', 'vertical', 'forward', 'all'], description: 'Movement axis' },
        amplitude_m: { type: 'number', description: 'Amplitude in meters' },
        frequency_hz: { type: 'number', description: 'Frequency in Hz' },
        timing: { type: 'string', enum: ['sync', 'staggered', 'reverse_stagger', 'center_out', 'random', 'sequential'], description: 'Drone timing' },
      },
      required: ['action'],
    },
  },
];

// --- Helpers ---

function resolveTargetDrones(args, allDroneIds) {
  if (args.drone_id) return [args.drone_id];
  if (args.group) return groups.getDronesInGroup(args.group);
  return allDroneIds;
}

async function getRichContext() {
  const states = await backend.getDroneStates();
  const allPositions = [...states.values()].map(s => s.position);
  const swarmCenter = allPositions.length > 0 ? [
    allPositions.reduce((s, p) => s + p[0], 0) / allPositions.length,
    allPositions.reduce((s, p) => s + p[1], 0) / allPositions.length,
    allPositions.reduce((s, p) => s + p[2], 0) / allPositions.length,
  ] : [0, 0, 0];

  const objects = detector.getObjects().map(obj => {
    const dx = obj.position[0] - swarmCenter[0];
    const dy = obj.position[1] - swarmCenter[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const dirs = [
      [-22.5, 22.5, 'ahead'], [22.5, 67.5, 'ahead-right'], [67.5, 112.5, 'right'],
      [112.5, 157.5, 'behind-right'], [-157.5, -112.5, 'behind-left'],
      [-112.5, -67.5, 'left'], [-67.5, -22.5, 'ahead-left'],
    ];
    let direction = 'behind';
    for (const [lo, hi, d] of dirs) { if (angle >= lo && angle < hi) { direction = d; break; } }
    return {
      id: obj.id, class: obj.class, confidence: Math.round(obj.confidence * 100),
      distance_m: Math.round(dist * 10) / 10, direction,
    };
  });

  const groupSummaries = {};
  for (const [name, group] of groups.groups) {
    if (group.drones.size === 0) continue;
    const droneStates = {};
    for (const droneId of group.drones) {
      const state = states.get(droneId);
      if (state) {
        droneStates[droneId] = {
          position: state.position.map(p => Math.round(p * 10) / 10),
          status: state.status, battery: state.battery,
        };
      }
    }
    groupSummaries[name] = {
      count: group.drones.size, formation: group.formation,
      task: group.task?.type || 'idle', drones: droneStates,
    };
  }

  return { swarm: { total: states.size, center: swarmCenter.map(p => Math.round(p * 10) / 10), groups: groupSummaries }, objects };
}

async function formatWithContext(message) {
  const ctx = await getRichContext();
  const lines = [message, '---'];
  lines.push(`📍 Swarm (${ctx.swarm.total} drones):`);
  for (const [name, g] of Object.entries(ctx.swarm.groups)) {
    lines.push(`  ${name} (${g.count}): ${g.task} ${g.formation !== 'none' ? 'in ' + g.formation : ''}`);
  }
  if (ctx.objects.length > 0) {
    lines.push('👁️ Detected:');
    for (const obj of ctx.objects.slice(0, 5)) {
      lines.push(`  ${obj.class}: ${obj.distance_m}m ${obj.direction}`);
    }
  }
  return `${lines.join('\n')}\n<context>${JSON.stringify(ctx)}</context>`;
}

// --- Tool Execution ---

async function executeTool(name, args) {
  const allDroneIds = [...(await backend.getDroneStates()).keys()];

  switch (name) {
    case 'drone_command': {
      const droneIds = resolveTargetDrones(args, allDroneIds);
      const target = args.group || args.drone_id || 'all';

      switch (args.action) {
        case 'takeoff': {
          const alt = args.altitude_m || 5;
          const spd = resolveSpeed(args.speed || 'normal');
          await Promise.all(droneIds.map(id => backend.takeoff(id, alt, spd)));
          if (args.group) groups.setGroupTask(args.group, { type: 'taking off', altitude_m: alt });
          return formatWithContext(`${target}: ${droneIds.length} drone(s) taking off to ${alt}m`);
        }
        case 'land': {
          const spd = resolveSpeed(args.speed || 'slow');
          await Promise.all(droneIds.map(id => backend.land(id, spd)));
          if (args.group) groups.setGroupTask(args.group, { type: 'landing' });
          return formatWithContext(`${target}: ${droneIds.length} drone(s) landing`);
        }
        case 'hover': {
          await Promise.all(droneIds.map(id => backend.hover(id)));
          if (args.group) groups.setGroupTask(args.group, { type: 'hovering' });
          return formatWithContext(`${target}: hovering`);
        }
        case 'rtl': {
          await Promise.all(droneIds.map(id => backend.rtl(id)));
          if (args.group) groups.setGroupTask(args.group, { type: 'returning' });
          return formatWithContext(`${target}: returning to launch`);
        }
        case 'emergency': {
          await backend.emergency(args.drone_id);
          return formatWithContext('EMERGENCY STOP executed');
        }
        default:
          return `Unknown action: ${args.action}`;
      }
    }

    case 'drone_move': {
      const droneIds = resolveTargetDrones(args, allDroneIds);
      const { vector, frame } = resolveDirection(args.direction);
      const scaled = scaleVector(vector, args.distance_m);
      const speed = resolveSpeed(args.speed || 'normal');
      Promise.all(droneIds.map(id => backend.goTo(id, scaled[0], scaled[1], scaled[2], speed, frame)))
        .catch(err => console.error('[move] Error:', err));
      if (args.group) groups.setGroupTask(args.group, { type: 'moving', direction: args.direction, distance_m: args.distance_m });
      const target = args.group || args.drone_id || 'all';
      return formatWithContext(`${target}: ${droneIds.length} drone(s) moving ${args.direction} ${args.distance_m}m`);
    }

    case 'drone_formation': {
      const droneIds = resolveTargetDrones(args, allDroneIds);
      const spacing = args.spacing_m || 5;
      let offsets;
      
      // Try built-in formation first, then custom shapes
      try {
        offsets = resolveFormation(args.shape, droneIds.length, spacing);
      } catch {
        const shape = getShape(args.shape);
        if (!shape) {
          const builtIn = 'line, v, circle, ring, square, grid, column, echelon';
          const custom = listShapes();
          return `Unknown shape: "${args.shape}". Built-in: ${builtIn}. Custom: ${custom.length ? custom.join(', ') : 'none (create with drone_choreograph)'}`;
        }
        
        // Animated shape — delegate to backend
        if (shape.duration_s || shape.keyframes || shape.motion) {
          const result = await backend.executeChoreography(shape, droneIds, spacing);
          if (args.group) {
            groups.setGroupFormation(args.group, args.shape, spacing);
            groups.setGroupTask(args.group, { type: 'choreography', shape: args.shape, duration_s: shape.duration_s });
          }
          return formatWithContext(`${args.group || 'Swarm'}: ${args.shape} dispatched to ${result.dispatched} drones (${result.duration_s}s)`);
        }
        
        offsets = resolveShape(args.shape, droneIds.length, spacing);
        if (!offsets) return `Failed to resolve shape "${args.shape}"`;
      }
      
      if (args.modifier) {
        const mod = getModifier(args.modifier);
        if (!mod) return `Unknown modifier: ${args.modifier}`;
        offsets = applyModifierToFormation(args.modifier, offsets, 0);
      }
      await backend.setFormation(offsets, droneIds);
      if (args.group) {
        groups.setGroupFormation(args.group, args.shape, spacing);
        groups.setGroupTask(args.group, { type: 'forming', shape: args.shape });
      }
      const modNote = args.modifier ? ` with ${args.modifier}` : '';
      return formatWithContext(`${args.group || 'Swarm'}: ${args.shape} formation${modNote}, ${spacing}m spacing`);
    }

    case 'drone_search': {
      const droneIds = resolveTargetDrones(args, allDroneIds);
      const waypoints = resolvePattern(args.pattern, {
        width: args.width_m, height: args.height_m, spacing: args.spacing_m, altitude: args.altitude_m,
      });
      const perDrone = Math.ceil(waypoints.length / droneIds.length);
      for (let i = 0; i < droneIds.length; i++) {
        const wp = waypoints.slice(i * perDrone, (i + 1) * perDrone);
        if (wp.length > 0) await backend.followPath(droneIds[i], wp, resolveSpeed('normal'));
      }
      if (args.group) groups.setGroupTask(args.group, { type: 'searching', pattern: args.pattern });
      return formatWithContext(`${args.group || 'Swarm'}: ${args.pattern} search, ${waypoints.length} waypoints across ${droneIds.length} drones`);
    }

    case 'drone_follow': {
      const targetInfo = detector.getObjectPosition(args.target);
      if (!targetInfo) {
        const objects = detector.getObjects();
        const avail = objects.length > 0 ? objects.map(o => `${o.class} (${o.id})`).join(', ') : 'none';
        return `Cannot locate "${args.target}". Available: ${avail}`;
      }
      const dist = args.distance_m || 10;
      const pos = targetInfo.position;
      const prediction = detector.predictPosition(args.target, 0.5) || targetInfo;
      const vel = prediction.velocity || [0, 0, 0];
      const spd = Math.sqrt(vel[0] ** 2 + vel[1] ** 2) || 0.01;
      const followPos = [pos[0] - (vel[0] / spd) * dist, pos[1] - (vel[1] / spd) * dist, pos[2] + 5];
      const droneIds = resolveTargetDrones(args, allDroneIds);
      if (args.formation) {
        let offsets = resolveFormation(args.formation, droneIds.length, 5);
        if (args.modifier) offsets = applyModifierToFormation(args.modifier, offsets, 0);
        await backend.setFormation(offsets, droneIds);
      }
      Promise.all(droneIds.map(id => backend.goTo(id, followPos[0], followPos[1], followPos[2], resolveSpeed('normal'), 'earth')))
        .catch(err => console.error('[follow] Error:', err));
      if (args.group) groups.setGroupTask(args.group, { type: 'following', target: args.target });
      const formNote = args.formation ? ` in ${args.formation}` : '';
      return formatWithContext(`Following ${args.target}${formNote} at ${dist}m`);
    }

    case 'drone_query': {
      const what = args.what || 'status';
      switch (what) {
        case 'detect': {
          const objects = detector.getObjects();
          if (objects.length === 0) return formatWithContext('No objects detected.');
          const lines = objects.map(o => `${o.id}: ${o.class} (${(o.confidence * 100).toFixed(0)}%)`);
          return formatWithContext(`Detected:\n${lines.join('\n')}`);
        }
        case 'locate': {
          const info = detector.getObjectPosition(args.target);
          if (!info) return `Cannot locate "${args.target}"`;
          const obj = detector.findObject(args.target);
          return formatWithContext(`${obj.class} (${obj.id}): ${(info.confidence * 100).toFixed(0)}% confidence`);
        }
        default:
          return formatWithContext('Status report');
      }
    }

    case 'drone_group': {
      switch (args.action) {
        case 'assign': {
          if (!args.drones || !args.group) return 'Need drones array and group name';
          const group = groups.assign(args.drones, args.group);
          return formatWithContext(`Assigned ${args.drones.length} drones to "${args.group}" (${group.drones.size} total)`);
        }
        case 'disband': {
          if (!args.group) return 'Need group name';
          const disbanded = groups.disband(args.group);
          if (!disbanded || disbanded.length === 0) return `Group "${args.group}" not found`;
          return formatWithContext(`Disbanded "${args.group}", ${disbanded.length} drones returned to idle`);
        }
        case 'list': {
          const list = groups.listGroups();
          if (list.length === 0) return formatWithContext('No active groups');
          return formatWithContext(`Groups: ${list.join(', ')}`);
        }
        default:
          return `Unknown group action: ${args.action}`;
      }
    }

    case 'drone_choreograph': {
      switch (args.action) {
        case 'create': {
          if (!args.name || !args.curves) return 'Need name and curves array';
          try {
            const shape = createShape(args.name, args.curves || [], { 
              scale: args.scale_m || 1, 
              save: args.save !== false,
              duration_s: args.duration_s || null,
              keyframes: args.keyframes || null,
              motion: args.motion || null,
              easing: args.easing || null,
            });
            const saved = args.save !== false ? ' (saved)' : '';
            const animated = shape.duration_s ? ` (animated: ${shape.duration_s}s)` : '';
            return formatWithContext(`Shape "${args.name}" created from ${args.curves.length} curve(s)${saved}${animated}. Use in drone_formation with shape="${args.name}".`);
          } catch (err) {
            return `Error creating shape: ${err.message}`;
          }
        }
        case 'list': {
          const shapes = listShapes();
          if (shapes.length === 0) return 'No custom shapes saved. Create one with action="create".';
          return `Custom shapes: ${shapes.join(', ')}`;
        }
        case 'delete': {
          if (!args.name) return 'Need shape name';
          const ok = deleteShape(args.name);
          return ok ? `Deleted shape "${args.name}"` : `Shape "${args.name}" not found`;
        }
        default:
          return `Unknown choreograph action: ${args.action}`;
      }
    }

    case 'drone_modifier': {
      switch (args.action) {
        case 'define': {
          if (!args.name) return 'Need modifier name';
          const mod = defineModifier(args);
          return `Modifier "${mod.name}" defined: ${mod.pattern} on ${mod.axis}, ${mod.amplitude_m}m, ${mod.frequency_hz}Hz`;
        }
        case 'list': {
          return `Modifiers: ${listModifiers().join(', ')}`;
        }
        default:
          return `Unknown modifier action: ${args.action}`;
      }
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
        await detector.start();
        groups.initialize([...(await backend.getDroneStates()).keys()]);
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'autom8te-intent', version: '2.0.0' }, capabilities: { tools: {} } } };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools } };
      case 'tools/call': {
        const { name, arguments: args } = params;
        const result = await executeTool(name, args || {});
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] } };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown: ${method}` } };
    }
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: error.message } };
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    const resp = await handleMessage(msg);
    console.log(JSON.stringify(resp));
  } catch { console.log(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } })); }
});
rl.on('close', () => process.exit(0));
console.error(`[AutoM8te Intent Layer] Started with backend: ${BACKEND}`);
