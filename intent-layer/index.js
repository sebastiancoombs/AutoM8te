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
import { MockDetector } from './perception/detector.js';
import { GroupManager } from './state/groups.js';
import { MockAdapter } from './adapters/mock.js';
import { Aerostack2Adapter } from './adapters/aerostack2.js';
import { PyBulletAdapter } from './adapters/pybullet.js';

// --- Configuration ---

const BACKEND = process.env.AUTOM8TE_BACKEND || 'mock';
const DRONE_COUNT = parseInt(process.env.AUTOM8TE_DRONES || '4', 10);
const GUI = process.env.AUTOM8TE_GUI === 'true';
const PERCEPTION = process.env.AUTOM8TE_PERCEPTION || 'mock';

// --- Perception ---
let detector;
if (PERCEPTION === 'yolo') {
  // Full YOLO detector (requires ultralytics)
  const { ObjectDetector } = await import('./perception/detector.js');
  detector = new ObjectDetector();
} else {
  // Mock detector for testing
  detector = new MockDetector();
}

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

// --- Group Manager ---
const groups = new GroupManager();

// --- MCP Protocol Handlers ---

const tools = [
  {
    name: 'takeoff',
    description: 'Take off drones to specified altitude',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for all)' },
        group: { type: 'string', description: 'Group name to command (e.g., "alpha")' },
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
        group: { type: 'string', description: 'Group name to command' },
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
        group: { type: 'string', description: 'Group name to command (e.g., "alpha")' },
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
        group: { type: 'string', description: 'Group to form (omit for all active drones)' },
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
    description: 'Follow a tracked object using perception. Target can be class name (person, car, truck) or object ID.',
    inputSchema: {
      type: 'object',
      properties: {
        drone_id: { type: 'string', description: 'Drone ID (omit for lead drone)' },
        group: { type: 'string', description: 'Group to follow with (omit for all active)' },
        target: { type: 'string', description: 'Target to follow (e.g., "person", "car", "truck", or object ID)' },
        distance_m: { type: 'number', description: 'Follow distance in meters (default: 10)' },
        formation: { type: 'string', description: 'Swarm formation while following (line, v, etc.)' },
        modifier: { type: 'string', description: 'Movement modifier while following' },
      },
      required: ['target'],
    },
  },
  {
    name: 'detect',
    description: 'List currently detected objects in view',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'locate',
    description: 'Get the position of a specific object',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Object class or ID to locate' },
      },
      required: ['target'],
    },
  },
  {
    name: 'status',
    description: 'Get human-readable swarm status summary',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Specific group to query' },
        drone_id: { type: 'string', description: 'Specific drone to query' },
      },
    },
  },
  // --- Group Management ---
  {
    name: 'assign',
    description: 'Assign drones to a named group. Creates group if it doesn\'t exist.',
    inputSchema: {
      type: 'object',
      properties: {
        drones: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Drone IDs to assign (e.g., ["drone0", "drone1"])' 
        },
        group: { type: 'string', description: 'Group name (e.g., "alpha", "bravo")' },
      },
      required: ['drones', 'group'],
    },
  },
  {
    name: 'disband',
    description: 'Disband a group - all drones return to idle pool',
    inputSchema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Group name to disband' },
      },
      required: ['group'],
    },
  },
  {
    name: 'groups',
    description: 'List all active groups and their status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// --- Tool Execution ---

/**
 * Resolve target drones from args (drone_id, group, or all)
 */
function resolveTargetDrones(args, allDroneIds) {
  if (args.drone_id) {
    return [args.drone_id];
  }
  if (args.group) {
    return groups.getDronesInGroup(args.group);
  }
  return allDroneIds;
}

/**
 * Get rich structured context for LLM
 */
async function getRichContext() {
  const positions = new Map();
  const states = await backend.getDroneStates();
  for (const [id, state] of states) {
    positions.set(id, state.position);
  }
  
  // Get swarm center
  const allPositions = [...positions.values()];
  const swarmCenter = allPositions.length > 0 ? [
    allPositions.reduce((s, p) => s + p[0], 0) / allPositions.length,
    allPositions.reduce((s, p) => s + p[1], 0) / allPositions.length,
    allPositions.reduce((s, p) => s + p[2], 0) / allPositions.length,
  ] : [0, 0, 0];
  
  // Get detected objects with relative positions
  const objects = detector.getObjects();
  
  const detectedWithRelative = objects.map(obj => {
    const dx = obj.position[0] - swarmCenter[0];
    const dy = obj.position[1] - swarmCenter[1];
    const distance_m = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    // Convert angle to direction
    let direction;
    if (angle >= -22.5 && angle < 22.5) direction = 'ahead';
    else if (angle >= 22.5 && angle < 67.5) direction = 'ahead-right';
    else if (angle >= 67.5 && angle < 112.5) direction = 'right';
    else if (angle >= 112.5 && angle < 157.5) direction = 'behind-right';
    else if (angle >= 157.5 || angle < -157.5) direction = 'behind';
    else if (angle >= -157.5 && angle < -112.5) direction = 'behind-left';
    else if (angle >= -112.5 && angle < -67.5) direction = 'left';
    else direction = 'ahead-left';
    
    // Estimate velocity if trajectory available
    let velocity = null;
    let speed_mps = null;
    let heading = null;
    if (obj.trajectory && obj.trajectory.length >= 2) {
      const recent = obj.trajectory.slice(-5);
      const first = recent[0];
      const last = recent[recent.length - 1];
      const dt = (recent.length - 1) * 0.1;
      velocity = [
        (last[0] - first[0]) / dt,
        (last[1] - first[1]) / dt,
        (last[2] - first[2]) / dt,
      ];
      speed_mps = Math.sqrt(velocity[0]**2 + velocity[1]**2 + velocity[2]**2);
      heading = Math.atan2(velocity[1], velocity[0]) * 180 / Math.PI;
    }
    
    return {
      id: obj.id,
      class: obj.class,
      confidence: Math.round(obj.confidence * 100),
      position: obj.position.map(p => Math.round(p * 10) / 10),
      relative: {
        distance_m: Math.round(distance_m * 10) / 10,
        direction,
        angle_deg: Math.round(angle),
      },
      motion: speed_mps ? {
        speed_mps: Math.round(speed_mps * 10) / 10,
        heading_deg: Math.round(heading),
        velocity: velocity.map(v => Math.round(v * 10) / 10),
      } : null,
    };
  });

  // Build group summaries
  const groupSummaries = {};
  for (const [name, group] of groups.groups) {
    if (group.drones.size === 0) continue;
    
    const droneStates = {};
    let groupCenter = [0, 0, 0];
    let count = 0;
    
    for (const droneId of group.drones) {
      const state = states.get(droneId);
      if (state) {
        droneStates[droneId] = {
          position: state.position.map(p => Math.round(p * 10) / 10),
          status: state.status,
          battery: state.battery,
          heading_deg: state.heading ? Math.round(state.heading * 180 / Math.PI) : 0,
        };
        groupCenter[0] += state.position[0];
        groupCenter[1] += state.position[1];
        groupCenter[2] += state.position[2];
        count++;
      }
    }
    
    if (count > 0) {
      groupCenter = groupCenter.map(v => Math.round((v / count) * 10) / 10);
    }
    
    groupSummaries[name] = {
      count: group.drones.size,
      formation: group.formation,
      spacing_m: group.spacing,
      task: group.task,
      center: groupCenter,
      drones: droneStates,
    };
  }

  return {
    timestamp: Date.now(),
    swarm: {
      total_drones: states.size,
      center: swarmCenter.map(p => Math.round(p * 10) / 10),
      groups: groupSummaries,
    },
    perception: {
      objects: detectedWithRelative,
      object_count: detectedWithRelative.length,
    },
  };
}

/**
 * Get human-readable context string
 */
async function getContextString() {
  const ctx = await getRichContext();
  const lines = [`📍 Swarm (${ctx.swarm.total_drones} drones):`];

  for (const [name, group] of Object.entries(ctx.swarm.groups)) {
    const pos = group.center ? ` at [${group.center.join(', ')}]` : '';
    const form = group.formation !== 'none' ? ` in ${group.formation}` : '';
    const task = group.task?.type || 'idle';
    lines.push(`  ${name} (${group.count}): ${task}${form}${pos}`);
  }

  if (ctx.perception.object_count > 0) {
    lines.push('');
    lines.push('👁️ Detected:');
    for (const obj of ctx.perception.objects.slice(0, 5)) {
      const dist = `${obj.relative.distance_m}m ${obj.relative.direction}`;
      const moving = obj.motion ? ` (moving ${obj.motion.speed_mps}m/s)` : '';
      lines.push(`  ${obj.class}: ${dist}${moving}`);
    }
  }

  return lines.join('\n');
}

/**
 * Wrap result with both human-readable and structured context
 */
async function withContext(result) {
  const richContext = await getRichContext();
  const humanContext = await getContextString();
  
  // Include both: human-readable for quick understanding, JSON for precise reasoning
  return {
    message: result,
    context: richContext,
    summary: humanContext,
  };
}

/**
 * Format tool result with context
 */
function formatResult(resultWithContext) {
  if (typeof resultWithContext === 'string') {
    return resultWithContext;
  }
  
  const { message, context, summary } = resultWithContext;
  
  // Human-readable output with JSON context block
  return `${message}

---
${summary}

<context>
${JSON.stringify(context, null, 2)}
</context>`;
}

async function executeTool(name, args) {
  const allDroneIds = [...(await backend.getDroneStates()).keys()];
  const droneIds = resolveTargetDrones(args, allDroneIds);

  switch (name) {
    case 'takeoff': {
      const altitude = args.altitude_m || 5;
      const speed = resolveSpeed(args.speed || 'normal');
      await Promise.all(droneIds.map(id => backend.takeoff(id, altitude, speed)));
      
      // Update group task
      if (args.group) {
        groups.setGroupTask(args.group, { type: 'taking off', altitude_m: altitude });
      }
      
      const target = args.group || (args.drone_id ? args.drone_id : 'all');
      return withContext(`${target}: ${droneIds.length} drone(s) taking off to ${altitude}m`);
    }

    case 'land': {
      const speed = resolveSpeed(args.speed || 'slow');
      await Promise.all(droneIds.map(id => backend.land(id, speed)));
      
      if (args.group) {
        groups.setGroupTask(args.group, { type: 'landing' });
      }
      
      const target = args.group || (args.drone_id ? args.drone_id : 'all');
      return withContext(`${target}: ${droneIds.length} drone(s) landing`);
    }

    case 'move': {
      const { vector, frame } = resolveDirection(args.direction);
      const scaled = scaleVector(vector, args.distance_m);
      const speed = resolveSpeed(args.speed || 'normal');
      
      Promise.all(droneIds.map(id => 
        backend.goTo(id, scaled[0], scaled[1], scaled[2], speed, frame)
      )).catch(err => console.error('[move] Error:', err));
      
      // Update task
      if (args.group) {
        groups.setGroupTask(args.group, { 
          type: 'moving', 
          direction: args.direction, 
          distance_m: args.distance_m 
        });
      }
      
      const target = args.group || (args.drone_id ? args.drone_id : 'all');
      return withContext(`${target}: ${droneIds.length} drone(s) moving ${args.direction} ${args.distance_m}m`);
    }

    case 'stop': {
      await Promise.all(droneIds.map(id => backend.hover(id)));
      
      if (args.group) {
        groups.setGroupTask(args.group, { type: 'hovering' });
      }
      
      const target = args.group || (args.drone_id ? args.drone_id : 'all');
      return withContext(`${target}: stopped`);
    }

    case 'rtl': {
      await Promise.all(droneIds.map(id => backend.rtl(id)));
      
      if (args.group) {
        groups.setGroupTask(args.group, { type: 'returning' });
      }
      
      const target = args.group || (args.drone_id ? args.drone_id : 'all');
      return withContext(`${target}: returning to launch`);
    }

    case 'emergency': {
      await backend.emergency(args.drone_id);
      return withContext(`EMERGENCY STOP executed`);
    }

    case 'form': {
      const targetDrones = resolveTargetDrones(args, allDroneIds);
      const count = targetDrones.length;
      const spacing = args.spacing_m || 5;
      let offsets = resolveFormation(args.shape, count, spacing);
      
      // Apply modifier if specified
      if (args.modifier) {
        const mod = getModifier(args.modifier);
        if (!mod) {
          return `Unknown modifier: ${args.modifier}. Use list_modifiers to see available options.`;
        }
        offsets = applyModifierToFormation(args.modifier, offsets, 0);
      }
      
      await backend.setFormation(offsets, targetDrones);
      
      // Update group formation
      if (args.group) {
        groups.setGroupFormation(args.group, args.shape, spacing);
        groups.setGroupTask(args.group, { type: 'forming', shape: args.shape });
      }
      
      const modifierNote = args.modifier ? ` with ${args.modifier} modifier` : '';
      const target = args.group || 'Swarm';
      return withContext(`${target} forming ${args.shape}${modifierNote} with ${spacing}m spacing`);
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
      
      // Use targeted drones
      const targetDrones = resolveTargetDrones(args, allDroneIds);
      const waypointsPerDrone = Math.ceil(waypoints.length / targetDrones.length);
      
      for (let i = 0; i < targetDrones.length; i++) {
        const start = i * waypointsPerDrone;
        const droneWaypoints = waypoints.slice(start, start + waypointsPerDrone);
        if (droneWaypoints.length > 0) {
          await backend.followPath(targetDrones[i], droneWaypoints, resolveSpeed('normal'));
        }
      }
      
      // Update group task
      if (args.group) {
        groups.setGroupTask(args.group, { 
          type: 'searching', 
          pattern: args.pattern,
          progress: 0 
        });
      }
      
      const target = args.group || 'Swarm';
      return withContext(`${target}: ${args.pattern} search started, ${waypoints.length} waypoints across ${targetDrones.length} drones`);
    }

    case 'follow': {
      // Get target position from perception
      const targetInfo = detector.getObjectPosition(args.target);
      if (!targetInfo) {
        const objects = detector.getObjects();
        const available = objects.length > 0 
          ? `Available: ${objects.map(o => `${o.class} (${o.id})`).join(', ')}`
          : 'No objects detected.';
        return `Cannot locate "${args.target}". ${available}`;
      }

      const followDistance = args.distance_m || 10;
      const targetPos = targetInfo.position;
      
      // Calculate follow position (behind target)
      const prediction = detector.predictPosition(args.target, 0.5) || targetInfo;
      const velocity = prediction.velocity || [0, 0, 0];
      
      // Follow point is behind target in direction of travel
      const speed = Math.sqrt(velocity[0]**2 + velocity[1]**2) || 0.01;
      const followPos = [
        targetPos[0] - (velocity[0] / speed) * followDistance,
        targetPos[1] - (velocity[1] / speed) * followDistance,
        targetPos[2] + 5, // Stay above target
      ];

      // Use targeted drones
      const targetDrones = resolveTargetDrones(args, allDroneIds);

      // If swarm formation specified, set it up
      if (args.formation) {
        const count = targetDrones.length;
        const spacing = 5;
        let offsets = resolveFormation(args.formation, count, spacing);
        if (args.modifier) {
          offsets = applyModifierToFormation(args.modifier, offsets, 0);
        }
        await backend.setFormation(offsets, targetDrones);
        
        if (args.group) {
          groups.setGroupFormation(args.group, args.formation, spacing);
        }
      }
      
      // Fire-and-forget continuous follow
      Promise.all(targetDrones.map(id => 
        backend.goTo(id, followPos[0], followPos[1], followPos[2], resolveSpeed('normal'), 'earth')
      )).catch(err => console.error('[follow] Error:', err));

      // Update group task
      if (args.group) {
        groups.setGroupTask(args.group, { type: 'following', target: args.target });
      }

      const formationNote = args.formation ? ` in ${args.formation} formation` : '';
      const groupNote = args.group ? `${args.group}: ` : '';
      return withContext(`${groupNote}Following ${args.target}${formationNote} at ${followDistance}m`);
    }

    case 'detect': {
      const objects = detector.getObjects();
      if (objects.length === 0) {
        return withContext('No objects detected.');
      }
      const lines = objects.map(obj => 
        `${obj.id}: ${obj.class} at [${obj.position.map(p => p.toFixed(1)).join(', ')}] (${(obj.confidence * 100).toFixed(0)}%)`
      );
      return `Detected objects:\n${lines.join('\n')}`;
    }

    case 'locate': {
      const info = detector.getObjectPosition(args.target);
      if (!info) {
        return `Cannot locate "${args.target}"`;
      }
      const obj = detector.findObject(args.target);
      const pos = info.position.map(p => p.toFixed(1)).join(', ');
      return withContext(`${obj.class} (${obj.id}) at [${pos}], confidence ${(info.confidence * 100).toFixed(0)}%`);
    }

    case 'status': {
      // Full rich context
      const ctx = await getRichContext();
      const summary = await getContextString();
      return {
        message: 'Current swarm status',
        context: ctx,
        summary,
      };
    }

    // --- Group Management ---
    
    case 'assign': {
      const group = groups.assign(args.drones, args.group);
      return withContext(`Assigned ${args.drones.length} drones to group "${args.group}" (now ${group.drones.size} total)`);
    }

    case 'disband': {
      const droneIds = groups.disband(args.group);
      if (!droneIds || droneIds.length === 0) {
        return `Group "${args.group}" not found or empty`;
      }
      return withContext(`Disbanded group "${args.group}", ${droneIds.length} drones returned to idle`);
    }

    case 'groups': {
      const groupList = groups.listGroups();
      if (groupList.length === 0) {
        return 'No active groups';
      }
      const ctx = await getRichContext();
      const summary = await getContextString();
      return {
        message: `Active groups: ${groupList.join(', ')}`,
        context: ctx,
        summary,
      };
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
        // Initialize groups with drone IDs
        const droneIds = [...(await backend.getDroneStates()).keys()];
        groups.initialize(droneIds);
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
        const formatted = formatResult(result);
        return {
          id,
          result: {
            content: [{ type: 'text', text: formatted }],
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
