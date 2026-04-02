#!/usr/bin/env node
/**
 * AutoM8te Intent Layer — HTTP Server
 * 
 * Simple HTTP wrapper around the MCP tools.
 * POST /api/tool  { name: "drone_command", args: { action: "takeoff" } }
 * GET  /api/tools  → list available tools
 * GET  /api/status → quick status
 */

import { createServer } from 'http';
import { createInterface } from 'readline';
import { resolveDirection, resolveSpeed, scaleVector } from './lookups/directions.js';
import { resolveFormation } from './lookups/formations.js';
import { resolvePattern } from './lookups/patterns.js';
import { defineModifier, getModifier, listModifiers, applyModifierToFormation } from './lookups/modifiers.js';
import { MockDetector } from './perception/detector.js';
import { GroupManager } from './state/groups.js';
import { MockAdapter } from './adapters/mock.js';
import { Aerostack2Adapter } from './adapters/aerostack2.js';
import { PyBulletAdapter } from './adapters/pybullet.js';
import { ArduPilotAdapter } from './adapters/ardupilot.js';
import { SupervisorAdapter } from './adapters/supervisor.js';

// --- Config ---
const PORT = parseInt(process.env.AUTOM8TE_PORT || '8080', 10);
const BACKEND = process.env.AUTOM8TE_BACKEND || 'mock';
const DRONE_COUNT = parseInt(process.env.AUTOM8TE_DRONES || '4', 10);
const PERCEPTION = process.env.AUTOM8TE_PERCEPTION || 'mock';

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
  case 'supervisor':
    backend = new SupervisorAdapter({ droneCount: DRONE_COUNT });
    break;
  case 'webots':
    backend = new ArduPilotAdapter({ droneCount: DRONE_COUNT, backend: 'webots' });
    break;
  case 'ardupilot':
    backend = new ArduPilotAdapter({ droneCount: DRONE_COUNT });
    break;
  case 'aerostack2':
    backend = new Aerostack2Adapter({ droneCount: DRONE_COUNT });
    break;
  case 'pybullet':
    backend = new PyBulletAdapter({ droneCount: DRONE_COUNT, gui: false });
    break;
  default:
    backend = new MockAdapter(DRONE_COUNT);
}

const groups = new GroupManager();

// --- Context ---
async function getRichContext() {
  const states = await backend.getDroneStates();
  const allPos = [...states.values()].map(s => s.position);
  const center = allPos.length > 0 ? [
    allPos.reduce((s, p) => s + p[0], 0) / allPos.length,
    allPos.reduce((s, p) => s + p[1], 0) / allPos.length,
    allPos.reduce((s, p) => s + p[2], 0) / allPos.length,
  ] : [0, 0, 0];

  const objects = detector.getObjects().map(obj => {
    const dx = obj.position[0] - center[0], dy = obj.position[1] - center[1];
    return {
      id: obj.id, class: obj.class,
      confidence: Math.round(obj.confidence * 100),
      distance_m: Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10,
    };
  });

  const groupSummaries = {};
  for (const [name, group] of groups.groups) {
    if (group.drones.size === 0) continue;
    const drones = {};
    for (const id of group.drones) {
      const s = states.get(id);
      if (s) drones[id] = { position: s.position.map(p => Math.round(p * 10) / 10), status: s.status, battery: s.battery };
    }
    groupSummaries[name] = { count: group.drones.size, formation: group.formation, task: group.task?.type || 'idle', drones };
  }

  return { swarm: { total: states.size, center: center.map(p => Math.round(p * 10) / 10), groups: groupSummaries }, objects };
}

function resolveTargetDrones(args, allIds) {
  if (args.drone_id) return [args.drone_id];
  if (args.group) return groups.getDronesInGroup(args.group);
  return allIds;
}

// --- Tool Execution (same as index.js) ---
async function executeTool(name, args) {
  const allDroneIds = [...(await backend.getDroneStates()).keys()];
  const ctx = async (msg) => ({ result: msg, context: await getRichContext() });

  switch (name) {
    case 'drone_command': {
      const ids = resolveTargetDrones(args, allDroneIds);
      const target = args.group || args.drone_id || 'all';
      switch (args.action) {
        case 'takeoff': {
          const alt = args.altitude_m || 5;
          await Promise.all(ids.map(id => backend.takeoff(id, alt, resolveSpeed(args.speed || 'normal'))));
          if (args.group) groups.setGroupTask(args.group, { type: 'taking off' });
          return ctx(`${target}: ${ids.length} drone(s) taking off to ${alt}m`);
        }
        case 'land': {
          await Promise.all(ids.map(id => backend.land(id, resolveSpeed(args.speed || 'slow'))));
          if (args.group) groups.setGroupTask(args.group, { type: 'landing' });
          return ctx(`${target}: landing`);
        }
        case 'hover': {
          await Promise.all(ids.map(id => backend.hover(id)));
          return ctx(`${target}: hovering`);
        }
        case 'rtl': {
          await Promise.all(ids.map(id => backend.rtl(id)));
          return ctx(`${target}: returning to launch`);
        }
        case 'emergency': {
          await backend.emergency(args.drone_id);
          return ctx('EMERGENCY STOP');
        }
        default: return { error: `Unknown action: ${args.action}` };
      }
    }
    case 'drone_move': {
      const ids = resolveTargetDrones(args, allDroneIds);
      const { vector, frame } = resolveDirection(args.direction);
      const scaled = scaleVector(vector, args.distance_m);
      await Promise.all(ids.map(id => backend.goTo(id, scaled[0], scaled[1], scaled[2], resolveSpeed(args.speed || 'normal'), frame)));
      if (args.group) groups.setGroupTask(args.group, { type: 'moving', direction: args.direction });
      return ctx(`${args.group || args.drone_id || 'all'}: moving ${args.direction} ${args.distance_m}m`);
    }
    case 'drone_formation': {
      const ids = resolveTargetDrones(args, allDroneIds);
      const spacing = args.spacing_m || 5;
      let offsets = resolveFormation(args.shape, ids.length, spacing);
      if (args.modifier) {
        const mod = getModifier(args.modifier);
        if (!mod) return { error: `Unknown modifier: ${args.modifier}` };
        offsets = applyModifierToFormation(args.modifier, offsets, 0);
      }
      await backend.setFormation(offsets, ids);
      if (args.group) groups.setGroupFormation(args.group, args.shape, spacing);
      return ctx(`${args.group || 'Swarm'}: ${args.shape}, ${spacing}m spacing`);
    }
    case 'drone_search': {
      const ids = resolveTargetDrones(args, allDroneIds);
      const wp = resolvePattern(args.pattern, { width: args.width_m, height: args.height_m, spacing: args.spacing_m, altitude: args.altitude_m });
      const per = Math.ceil(wp.length / ids.length);
      for (let i = 0; i < ids.length; i++) {
        const slice = wp.slice(i * per, (i + 1) * per);
        if (slice.length > 0) await backend.followPath(ids[i], slice, resolveSpeed('normal'));
      }
      return ctx(`${args.pattern} search: ${wp.length} waypoints across ${ids.length} drones`);
    }
    case 'drone_follow': {
      const info = detector.getObjectPosition(args.target);
      if (!info) return { error: `Cannot locate "${args.target}"` };
      const dist = args.distance_m || 10;
      const pos = info.position;
      const vel = (detector.predictPosition(args.target, 0.5) || info).velocity || [0, 0, 0];
      const spd = Math.sqrt(vel[0] ** 2 + vel[1] ** 2) || 0.01;
      const fp = [pos[0] - (vel[0] / spd) * dist, pos[1] - (vel[1] / spd) * dist, pos[2] + 5];
      const ids = resolveTargetDrones(args, allDroneIds);
      if (args.formation) {
        let off = resolveFormation(args.formation, ids.length, 5);
        if (args.modifier) off = applyModifierToFormation(args.modifier, off, 0);
        await backend.setFormation(off, ids);
      }
      await Promise.all(ids.map(id => backend.goTo(id, fp[0], fp[1], fp[2], resolveSpeed('normal'), 'earth')));
      return ctx(`Following ${args.target} at ${dist}m`);
    }
    case 'drone_query': {
      const what = args.what || 'status';
      if (what === 'detect') {
        const objs = detector.getObjects();
        return ctx(objs.length ? objs.map(o => `${o.id}: ${o.class}`).join(', ') : 'No objects detected');
      }
      if (what === 'locate') {
        const info = detector.getObjectPosition(args.target);
        if (!info) return { error: `Cannot locate "${args.target}"` };
        return ctx(`${args.target}: found`);
      }
      return ctx('Status report');
    }
    case 'drone_group': {
      if (args.action === 'assign') {
        if (!args.drones || !args.group) return { error: 'Need drones[] and group' };
        const g = groups.assign(args.drones, args.group);
        return ctx(`Assigned ${args.drones.length} to "${args.group}" (${g.drones.size} total)`);
      }
      if (args.action === 'disband') {
        const d = groups.disband(args.group);
        return ctx(d ? `Disbanded "${args.group}"` : `Group not found`);
      }
      if (args.action === 'list') {
        const list = groups.listGroups();
        return ctx(list.length ? `Groups: ${list.join(', ')}` : 'No groups');
      }
      return { error: `Unknown group action: ${args.action}` };
    }
    case 'drone_modifier': {
      if (args.action === 'list') return ctx(`Modifiers: ${listModifiers().join(', ')}`);
      if (args.action === 'define') {
        if (!args.name) return { error: 'Need name' };
        const m = defineModifier(args);
        return ctx(`Defined "${m.name}"`);
      }
      return { error: `Unknown modifier action: ${args.action}` };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// --- HTTP Server ---
const TOOL_NAMES = ['drone_command', 'drone_move', 'drone_formation', 'drone_search', 'drone_follow', 'drone_query', 'drone_group', 'drone_modifier'];

async function init() {
  console.error(`[AutoM8te] Connecting to backend: ${BACKEND} (${DRONE_COUNT} drones)...`);
  await backend.connect();
  console.error(`[AutoM8te] Backend connected: ${backend.constructor.name}`);
  await detector.start();
  groups.initialize([...(await backend.getDroneStates()).keys()]);
  console.error(`[AutoM8te] Ready — ${DRONE_COUNT} drones`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    if (req.method === 'GET' && req.url === '/api/tools') {
      res.end(JSON.stringify({ tools: TOOL_NAMES }));
    } else if (req.method === 'GET' && req.url === '/api/status') {
      const ctx = await getRichContext();
      res.end(JSON.stringify(ctx));
    } else if (req.method === 'POST' && req.url === '/api/tool') {
      const { name, args } = await parseBody(req);
      const result = await executeTool(name, args || {});
      res.end(JSON.stringify(result));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found. Use POST /api/tool or GET /api/status' }));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

await init();
server.listen(PORT, () => {
  console.error(`[AutoM8te] HTTP server on http://localhost:${PORT}`);
  console.error(`[AutoM8te] POST /api/tool { name, args } | GET /api/status | GET /api/tools`);
});
