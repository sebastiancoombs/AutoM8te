/**
 * Behavior Tree Action & Condition Nodes
 * 
 * Built on the custom async BT engine (bt.js).
 * 
 * Actions are StatefulAction (onStart/onRunning/onHalted) for proper
 * async lifecycle. Conditions are SyncAction (instant SUCCESS/FAILURE).
 * 
 * Blackboard keys (set by PlanManager before tree starts):
 *   backend     — SwarmBackend adapter
 *   detector    — perception system
 *   groups      — GroupManager
 *   droneIds    — string[] assigned drones
 *   targetClass — what to look for ("car", "person", etc.)
 *   params      — { altitude, radius, distance, spacing, pattern, width, height, aggressive }
 *   vars        — user-defined custom variables
 * 
 * Actions set during execution:
 *   targetId, targetPosition, targetVelocity, detectedObjects
 */

import { 
  SyncAction, StatefulAction, SUCCESS, FAILURE, RUNNING 
} from './bt.js';
import { resolvePattern } from '../lookups/patterns.js';
import { resolveFormation } from '../lookups/formations.js';
import { resolveSpeed } from '../lookups/directions.js';

// ─── Helper ─────────────────────────────────────────────────────────

function bb(node) { return node.bb; }

// ─── Conditions (SyncAction — instant) ──────────────────────────────

export function HasTarget() {
  return new SyncAction('hasTarget', (bb) =>
    bb.get('targetPosition') ? SUCCESS : FAILURE
  );
}

export function TargetLost() {
  return new SyncAction('targetLost', (bb) =>
    bb.get('targetPosition') ? FAILURE : SUCCESS
  );
}

export function HasEnoughDrones(min = 1) {
  return new SyncAction('hasEnoughDrones', (bb) =>
    (bb.get('droneIds')?.length || 0) >= min ? SUCCESS : FAILURE
  );
}

export function IsObjectDetected(cls) {
  return new SyncAction('isObjectDetected', (bb) => {
    const targetClass = cls || bb.get('vars')?.checkClass || bb.get('targetClass');
    const objects = bb.get('detector').getObjects();
    return objects.some(o => o.class === targetClass) ? SUCCESS : FAILURE;
  });
}

export function TargetInRange(maxDist = 30) {
  return new SyncAction('targetInRange', async (bb) => {
    const pos = bb.get('targetPosition');
    if (!pos) return FAILURE;
    const states = await bb.get('backend').getDroneStates();
    for (const id of bb.get('droneIds')) {
      const s = states.get(id);
      if (!s) continue;
      const dx = s.position[0] - pos[0];
      const dy = s.position[1] - pos[1];
      if (Math.sqrt(dx * dx + dy * dy) <= maxDist) return SUCCESS;
    }
    return FAILURE;
  });
}

export function AllAirborne() {
  return new SyncAction('allAirborne', async (bb) => {
    const states = await bb.get('backend').getDroneStates();
    for (const id of bb.get('droneIds')) {
      const s = states.get(id);
      if (!s || s.position[2] < 1) return FAILURE;
    }
    return SUCCESS;
  });
}

export function DronesInPosition(tolerance = 3) {
  return new SyncAction('dronesInPosition', async (bb) => {
    const targetPos = bb.get('_formationTargets');
    if (!targetPos) return SUCCESS; // No target positions set
    const states = await bb.get('backend').getDroneStates();
    for (const [droneId, goalPos] of Object.entries(targetPos)) {
      const s = states.get(droneId);
      if (!s) return FAILURE;
      const dx = s.position[0] - goalPos[0];
      const dy = s.position[1] - goalPos[1];
      if (Math.sqrt(dx * dx + dy * dy) > tolerance) return FAILURE;
    }
    return SUCCESS;
  });
}

// ─── Perception Actions ─────────────────────────────────────────────

export function ScanForTarget() {
  return new SyncAction('scanForTarget', (bb) => {
    const objects = bb.get('detector').getObjects();
    const targetClass = bb.get('targetClass');
    const match = objects.find(o => o.class === targetClass || o.id === targetClass);
    if (match) {
      bb.set('targetId', match.id);
      bb.set('targetPosition', match.position);
      bb.set('targetVelocity', match.velocity || [0, 0, 0]);
      bb.set('detectedObjects', objects);
      return SUCCESS;
    }
    return FAILURE;
  });
}

export function UpdateTargetPosition() {
  return new SyncAction('updateTargetPosition', (bb) => {
    const objects = bb.get('detector').getObjects();
    const targetId = bb.get('targetId');
    const targetClass = bb.get('targetClass');
    const match = objects.find(o => o.id === targetId || o.class === targetClass);
    if (match) {
      bb.set('targetPosition', match.position);
      bb.set('targetVelocity', match.velocity || [0, 0, 0]);
      bb.set('targetId', match.id);
      return SUCCESS;
    }
    // Target lost — clear position
    bb.set('targetPosition', null);
    return FAILURE;
  });
}

// ─── Movement Actions (Stateful — async lifecycle) ──────────────────

/**
 * Search pattern dispatch.
 * onStart: generates waypoints and sends them to drones.
 * onRunning: checks if drones have completed their paths.
 * onHalted: hovers all drones.
 */
export function DispatchSearch() {
  return new StatefulAction('dispatchSearch', {
    async onStart(bb) {
      const p = bb.get('params');
      const waypoints = resolvePattern(p.pattern || 'expanding_square', {
        width: p.width || 80,
        height: p.height || 80,
        spacing: p.spacing || 15,
        altitude: p.altitude || 10,
      });
      bb.set('_searchWaypoints', waypoints);
      bb.set('_searchStartedAt', Date.now());

      const droneIds = bb.get('droneIds');
      const backend = bb.get('backend');
      const perDrone = Math.ceil(waypoints.length / droneIds.length);

      for (let i = 0; i < droneIds.length; i++) {
        const wp = waypoints.slice(i * perDrone, (i + 1) * perDrone);
        if (wp.length > 0) {
          await backend.followPath(droneIds[i], wp, resolveSpeed('normal'));
        }
      }
      return RUNNING; // Drones are moving
    },

    async onRunning(bb) {
      // Search stays RUNNING until preempted (target found) or timeout.
      // The ReactiveSequence above will halt us when a scan succeeds.
      return RUNNING;
    },

    async onHalted(bb) {
      // Stop all drones
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

/**
 * Hover all drones. Instant action.
 */
export function HoverAll() {
  return new SyncAction('hoverAll', async (bb) => {
    const backend = bb.get('backend');
    await Promise.all(bb.get('droneIds').map(id => backend.hover(id).catch(() => {})));
    return SUCCESS;
  });
}

/**
 * Takeoff all drones.
 * onStart: sends takeoff command.
 * onRunning: checks if all drones are airborne.
 */
export function TakeoffAll() {
  return new StatefulAction('takeoffAll', {
    async onStart(bb) {
      const alt = bb.get('params').altitude || 10;
      const spd = resolveSpeed('normal');
      const backend = bb.get('backend');
      await Promise.all(bb.get('droneIds').map(id => backend.takeoff(id, alt, spd)));
      return RUNNING;
    },

    async onRunning(bb) {
      const states = await bb.get('backend').getDroneStates();
      const minAlt = (bb.get('params').altitude || 10) * 0.7;
      for (const id of bb.get('droneIds')) {
        const s = states.get(id);
        if (!s || s.position[2] < minAlt) return RUNNING;
      }
      return SUCCESS;
    },

    async onHalted(bb) {
      // Emergency: if halted during takeoff, hover
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

export function LandAll() {
  return new SyncAction('landAll', async (bb) => {
    const spd = resolveSpeed('slow');
    await Promise.all(bb.get('droneIds').map(id => bb.get('backend').land(id, spd).catch(() => {})));
    return SUCCESS;
  });
}

export function RtlAll() {
  return new SyncAction('rtlAll', async (bb) => {
    await Promise.all(bb.get('droneIds').map(id => bb.get('backend').rtl(id).catch(() => {})));
    return SUCCESS;
  });
}

// ─── Tactical Actions (Stateful) ────────────────────────────────────

/**
 * Surround — form a circle around target.
 * onStart: sends position commands.
 * onRunning: updates positions as target moves.
 * onHalted: hovers all.
 */
export function Surround() {
  return new StatefulAction('surround', {
    async onStart(bb) {
      return await sendSurroundPositions(bb);
    },

    async onRunning(bb) {
      // Re-send positions (target may have moved)
      return await sendSurroundPositions(bb);
    },

    async onHalted(bb) {
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

async function sendSurroundPositions(bb) {
  const pos = bb.get('targetPosition');
  if (!pos) return FAILURE;
  const r = bb.get('params').radius || 15;
  const alt = bb.get('params').altitude || 10;
  const droneIds = bb.get('droneIds');
  const n = droneIds.length;
  const backend = bb.get('backend');

  const targets = {};
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    targets[droneIds[i]] = [pos[0] + r * Math.cos(angle), pos[1] + r * Math.sin(angle), alt];
  }
  bb.set('_formationTargets', targets);

  // Try formation API, fallback to individual goTo
  try {
    await fetch('http://localhost:8080/api/formation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: targets, speed: 8, look_at: pos }),
    });
  } catch {
    for (const [id, p] of Object.entries(targets)) {
      await backend.goTo(id, p[0], p[1], p[2], resolveSpeed('normal'), 'earth').catch(() => {});
    }
  }
  return RUNNING;
}

/**
 * Follow — trail the target in V formation.
 */
export function Follow() {
  return new StatefulAction('follow', {
    async onStart(bb) { return sendFollowPositions(bb); },
    async onRunning(bb) { return sendFollowPositions(bb); },
    async onHalted(bb) {
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

function sendFollowPositions(bb) {
  const pos = bb.get('targetPosition');
  if (!pos) return FAILURE;
  const dist = bb.get('params').distance || 10;
  const alt = bb.get('params').altitude || 10;
  const vel = bb.get('targetVelocity') || [0, 0, 0];
  const spd = Math.sqrt(vel[0] ** 2 + vel[1] ** 2) || 0.01;
  const droneIds = bb.get('droneIds');
  const backend = bb.get('backend');

  const followX = pos[0] - (vel[0] / spd) * dist;
  const followY = pos[1] - (vel[1] / spd) * dist;

  if (droneIds.length === 1) {
    backend.goTo(droneIds[0], followX, followY, alt, resolveSpeed('normal'), 'earth').catch(() => {});
  } else {
    const offsets = resolveFormation('v', droneIds.length, 5);
    for (let i = 0; i < droneIds.length; i++) {
      const x = followX + offsets[i].offset[0];
      const y = followY + offsets[i].offset[1];
      backend.goTo(droneIds[i], x, y, alt, resolveSpeed('normal'), 'earth').catch(() => {});
    }
  }
  return RUNNING;
}

/**
 * Intercept — aggressive approach.
 */
export function Intercept() {
  return new StatefulAction('intercept', {
    async onStart(bb) { return sendInterceptCommand(bb); },
    async onRunning(bb) { return sendInterceptCommand(bb); },
    async onHalted(bb) {
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

async function sendInterceptCommand(bb) {
  const pos = bb.get('targetPosition');
  if (!pos) return FAILURE;
  const droneIds = bb.get('droneIds');

  const targets = {};
  targets[bb.get('targetId') || 'target_0'] = {
    position: pos,
    velocity: bb.get('targetVelocity') || [0, 0, 0],
  };

  try {
    const res = await fetch('http://localhost:8080/api/intercept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drone_ids: droneIds,
        targets,
        aggressive: bb.get('params').aggressive || false,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch {
    const alt = bb.get('params').altitude || 10;
    const spd = resolveSpeed(bb.get('params').aggressive ? 'fast' : 'normal');
    for (const id of droneIds) {
      await bb.get('backend').goTo(id, pos[0], pos[1], alt, spd, 'earth').catch(() => {});
    }
  }
  return RUNNING;
}

/**
 * Harass — orbit aggressively around target.
 */
export function Harass() {
  return new StatefulAction('harass', {
    async onStart(bb) {
      const pos = bb.get('targetPosition');
      if (!pos) return FAILURE;
      const r = bb.get('params').radius || 10;
      const alt = bb.get('params').altitude || 10;
      const droneIds = bb.get('droneIds');
      const n = droneIds.length;
      const steps = 12;
      const backend = bb.get('backend');

      for (let i = 0; i < n; i++) {
        const wps = [];
        for (let rep = 0; rep < 10; rep++) {
          for (let s = 0; s < steps; s++) {
            const angle = ((s + i * (steps / n)) / steps) * 2 * Math.PI;
            wps.push([pos[0] + r * Math.cos(angle), pos[1] + r * Math.sin(angle), alt]);
          }
        }
        await backend.followPath(droneIds[i], wps, resolveSpeed('fast'));
      }
      return RUNNING;
    },

    async onRunning() { return RUNNING; },

    async onHalted(bb) {
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

/**
 * GoToTarget — simple approach to target position.
 */
export function GoToTarget() {
  return new StatefulAction('goToTarget', {
    async onStart(bb) {
      const pos = bb.get('targetPosition');
      if (!pos) return FAILURE;
      const alt = bb.get('params').altitude || pos[2] || 10;
      const spd = resolveSpeed(bb.get('params').aggressive ? 'fast' : 'normal');
      for (const id of bb.get('droneIds')) {
        await bb.get('backend').goTo(id, pos[0], pos[1], alt, spd, 'earth').catch(() => {});
      }
      return RUNNING;
    },

    async onRunning(bb) {
      // Check if drones arrived
      const pos = bb.get('targetPosition');
      if (!pos) return FAILURE;
      const states = await bb.get('backend').getDroneStates();
      for (const id of bb.get('droneIds')) {
        const s = states.get(id);
        if (!s) continue;
        const dx = s.position[0] - pos[0];
        const dy = s.position[1] - pos[1];
        if (Math.sqrt(dx * dx + dy * dy) > 3) return RUNNING;
      }
      return SUCCESS;
    },

    async onHalted(bb) {
      const backend = bb.get('backend');
      for (const id of bb.get('droneIds')) {
        await backend.hover(id).catch(() => {});
      }
    },
  });
}

/**
 * SetFormation — arrange drones in a formation.
 */
export function SetFormation(shape) {
  return new SyncAction('setFormation', async (bb) => {
    const formation = shape || bb.get('vars')?.formation || bb.get('params').formation || 'line';
    const spacing = bb.get('params').spacing || 5;
    try {
      const offsets = resolveFormation(formation, bb.get('droneIds').length, spacing);
      await bb.get('backend').setFormation(offsets, bb.get('droneIds'));
      return SUCCESS;
    } catch {
      return FAILURE;
    }
  });
}

/**
 * SearchLastKnown — search around the last known target position.
 * Used as recovery when target is lost.
 */
export function SearchLastKnown() {
  return new StatefulAction('searchLastKnown', {
    async onStart(bb) {
      const lastPos = bb.get('_lastKnownPosition') || bb.get('targetPosition');
      if (!lastPos) return FAILURE;

      // Small expanding square around last known
      const waypoints = resolvePattern('expanding_square', {
        radius: 30, spacing: 8, altitude: bb.get('params').altitude || 10,
      });
      // Offset waypoints to last known position
      const offset = waypoints.map(wp => [wp[0] + lastPos[0], wp[1] + lastPos[1], wp[2]]);
      
      const droneIds = bb.get('droneIds');
      const backend = bb.get('backend');
      const perDrone = Math.ceil(offset.length / droneIds.length);

      for (let i = 0; i < droneIds.length; i++) {
        const wp = offset.slice(i * perDrone, (i + 1) * perDrone);
        if (wp.length > 0) {
          await backend.followPath(droneIds[i], wp, resolveSpeed('fast'));
        }
      }
      return RUNNING;
    },

    async onRunning() { return RUNNING; },

    async onHalted(bb) {
      for (const id of bb.get('droneIds')) {
        await bb.get('backend').hover(id).catch(() => {});
      }
    },
  });
}

// ─── Registry (for JSON tree builder) ───────────────────────────────

/**
 * Factory functions — each returns a fresh node instance.
 * This is critical: nodes carry state, so they can't be shared.
 */
export const ACTION_FACTORIES = {
  // Conditions
  hasTarget:         () => HasTarget(),
  targetLost:        () => TargetLost(),
  hasEnoughDrones:   () => HasEnoughDrones(),
  isObjectDetected:  () => IsObjectDetected(),
  targetInRange:     () => TargetInRange(),
  allAirborne:       () => AllAirborne(),
  dronesInPosition:  () => DronesInPosition(),

  // Perception
  scanForTarget:        () => ScanForTarget(),
  updateTargetPosition: () => UpdateTargetPosition(),

  // Movement
  dispatchSearch:  () => DispatchSearch(),
  hoverAll:        () => HoverAll(),
  takeoffAll:      () => TakeoffAll(),
  landAll:         () => LandAll(),
  rtlAll:          () => RtlAll(),
  goToTarget:      () => GoToTarget(),

  // Tactical
  surround:         () => Surround(),
  follow:           () => Follow(),
  intercept:        () => Intercept(),
  harass:           () => Harass(),
  setFormation:     () => SetFormation(),
  searchLastKnown:  () => SearchLastKnown(),
};
