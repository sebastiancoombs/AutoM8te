/**
 * Behavior Tree Action Nodes (Leaf Tasks)
 * 
 * Each action wraps a backend primitive. The blackboard holds:
 *   - backend: SwarmBackend adapter
 *   - detector: perception system
 *   - groups: GroupManager
 *   - droneIds: string[] — assigned drones for this tree
 *   - targetClass: string — what we're looking for
 *   - targetId: string|null — specific tracked object
 *   - targetPosition: [x,y,z]|null
 *   - params: { altitude, radius, distance, spacing, pattern, width, height, aggressive }
 *   - searchWaypoints: [[x,y,z], ...]
 *   - searchDispatched: boolean
 *   - vars: {} — user-defined variables for conditions
 */

import { Task, SUCCESS, FAILURE, RUNNING } from 'behaviortree';
import { resolvePattern } from '../lookups/patterns.js';
import { resolveFormation } from '../lookups/formations.js';
import { resolveSpeed } from '../lookups/directions.js';

// ─── Perception Actions ─────────────────────────────────────────────

/**
 * Scan for target. Sets targetId + targetPosition on blackboard if found.
 * Returns SUCCESS if target found, FAILURE if not.
 */
export const ScanForTarget = new Task({
  run(bb) {
    const objects = bb.detector.getObjects();
    const match = objects.find(o =>
      o.class === bb.targetClass || o.id === bb.targetClass
    );
    if (match) {
      bb.targetId = match.id;
      bb.targetPosition = match.position;
      bb.targetVelocity = match.velocity || [0, 0, 0];
      bb.detectedObjects = objects;
      return SUCCESS;
    }
    return FAILURE;
  },
});

/**
 * Update target position (for tracking loop). 
 * SUCCESS if still visible, FAILURE if lost.
 */
export const UpdateTargetPosition = new Task({
  run(bb) {
    const objects = bb.detector.getObjects();
    const match = objects.find(o =>
      o.id === bb.targetId || o.class === bb.targetClass
    );
    if (match) {
      bb.targetPosition = match.position;
      bb.targetVelocity = match.velocity || [0, 0, 0];
      bb.targetId = match.id;
      return SUCCESS;
    }
    return FAILURE;
  },
});

/**
 * Check if ANY object of a given class is detected.
 * Reads bb.vars.checkClass (or falls back to bb.targetClass).
 */
export const DetectAny = new Task({
  run(bb) {
    const cls = bb.vars?.checkClass || bb.targetClass;
    const objects = bb.detector.getObjects();
    return objects.some(o => o.class === cls) ? SUCCESS : FAILURE;
  },
});

// ─── Movement Actions ───────────────────────────────────────────────

/**
 * Dispatch search waypoints across drones. Only dispatches once.
 * Returns SUCCESS immediately (search is async).
 */
export const DispatchSearch = new Task({
  run(bb) {
    if (bb.searchDispatched) return SUCCESS;

    const p = bb.params;
    const waypoints = bb.searchWaypoints || resolvePattern(p.pattern || 'expanding_square', {
      width: p.width || 80,
      height: p.height || 80,
      spacing: p.spacing || 15,
      altitude: p.altitude || 10,
    });
    bb.searchWaypoints = waypoints;

    const perDrone = Math.ceil(waypoints.length / bb.droneIds.length);
    for (let i = 0; i < bb.droneIds.length; i++) {
      const wp = waypoints.slice(i * perDrone, (i + 1) * perDrone);
      if (wp.length > 0) {
        bb.backend.followPath(bb.droneIds[i], wp, resolveSpeed('normal')).catch(() => {});
      }
    }
    bb.searchDispatched = true;
    return SUCCESS;
  },
});

/**
 * Hover all assigned drones.
 */
export const HoverAll = new Task({
  run(bb) {
    for (const id of bb.droneIds) {
      bb.backend.hover(id).catch(() => {});
    }
    return SUCCESS;
  },
});

/**
 * Takeoff all assigned drones.
 */
export const TakeoffAll = new Task({
  run(bb) {
    const alt = bb.params.altitude || 10;
    const spd = resolveSpeed('normal');
    for (const id of bb.droneIds) {
      bb.backend.takeoff(id, alt, spd).catch(() => {});
    }
    return SUCCESS;
  },
});

/**
 * Land all assigned drones.
 */
export const LandAll = new Task({
  run(bb) {
    const spd = resolveSpeed('slow');
    for (const id of bb.droneIds) {
      bb.backend.land(id, spd).catch(() => {});
    }
    return SUCCESS;
  },
});

/**
 * RTL all assigned drones.
 */
export const RtlAll = new Task({
  run(bb) {
    for (const id of bb.droneIds) {
      bb.backend.rtl(id).catch(() => {});
    }
    return SUCCESS;
  },
});

/**
 * Move all drones toward target position (simple go-to).
 * Reads bb.targetPosition.
 */
export const GoToTarget = new Task({
  run(bb) {
    if (!bb.targetPosition) return FAILURE;
    const [x, y, z] = bb.targetPosition;
    const alt = bb.params.altitude || z || 10;
    const spd = resolveSpeed(bb.params.aggressive ? 'fast' : 'normal');
    for (const id of bb.droneIds) {
      bb.backend.goTo(id, x, y, alt, spd, 'earth').catch(() => {});
    }
    return SUCCESS;
  },
});

// ─── Tactical Actions ───────────────────────────────────────────────

/**
 * Surround target — drones form a circle around targetPosition.
 */
export const Surround = new Task({
  run(bb) {
    if (!bb.targetPosition) return FAILURE;
    const r = bb.params.radius || 15;
    const alt = bb.params.altitude || 10;
    const n = bb.droneIds.length;
    const [tx, ty] = bb.targetPosition;

    const positions = {};
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI;
      positions[bb.droneIds[i]] = [
        tx + r * Math.cos(angle),
        ty + r * Math.sin(angle),
        alt,
      ];
    }

    // Try formation API, fall back to individual goTo
    fetch('http://localhost:8080/api/formation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions, speed: 8, look_at: bb.targetPosition }),
    }).catch(() => {
      // Fallback: individual positioning
      for (const [id, pos] of Object.entries(positions)) {
        bb.backend.goTo(id, pos[0], pos[1], pos[2], resolveSpeed('normal'), 'earth').catch(() => {});
      }
    });

    return SUCCESS;
  },
});

/**
 * Follow target — maintain distance behind target's velocity vector.
 * Multi-drone: V formation trailing the target.
 */
export const Follow = new Task({
  run(bb) {
    if (!bb.targetPosition) return FAILURE;
    const dist = bb.params.distance || 10;
    const alt = bb.params.altitude || 10;
    const [tx, ty] = bb.targetPosition;
    const vel = bb.targetVelocity || [0, 0, 0];
    const spd = Math.sqrt(vel[0] ** 2 + vel[1] ** 2) || 0.01;

    // Position behind the target's velocity vector
    const followX = tx - (vel[0] / spd) * dist;
    const followY = ty - (vel[1] / spd) * dist;

    if (bb.droneIds.length === 1) {
      bb.backend.goTo(bb.droneIds[0], followX, followY, alt, resolveSpeed('normal'), 'earth').catch(() => {});
    } else {
      const offsets = resolveFormation('v', bb.droneIds.length, 5);
      for (let i = 0; i < bb.droneIds.length; i++) {
        const x = followX + offsets[i].offset[0];
        const y = followY + offsets[i].offset[1];
        bb.backend.goTo(bb.droneIds[i], x, y, alt, resolveSpeed('normal'), 'earth').catch(() => {});
      }
    }
    return SUCCESS;
  },
});

/**
 * Intercept target — aggressive approach via intercept API or direct.
 */
export const Intercept = new Task({
  run(bb) {
    if (!bb.targetPosition) return FAILURE;
    const targets = {};
    targets[bb.targetId || 'target_0'] = {
      position: bb.targetPosition,
      velocity: bb.targetVelocity || [0, 0, 0],
    };

    fetch('http://localhost:8080/api/intercept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drone_ids: bb.droneIds,
        targets,
        aggressive: bb.params.aggressive || false,
      }),
    }).catch(() => {
      // Fallback: direct approach
      const alt = bb.params.altitude || 10;
      const spd = resolveSpeed(bb.params.aggressive ? 'fast' : 'normal');
      for (const id of bb.droneIds) {
        bb.backend.goTo(id, bb.targetPosition[0], bb.targetPosition[1], alt, spd, 'earth').catch(() => {});
      }
    });

    return SUCCESS;
  },
});

/**
 * Harass target — orbit aggressively around target position.
 */
export const Harass = new Task({
  run(bb) {
    if (!bb.targetPosition) return FAILURE;
    const r = bb.params.radius || 10;
    const alt = bb.params.altitude || 10;
    const n = bb.droneIds.length;
    const [tx, ty] = bb.targetPosition;
    const steps = 12;

    for (let i = 0; i < n; i++) {
      const wps = [];
      for (let rep = 0; rep < 10; rep++) {
        for (let s = 0; s < steps; s++) {
          const angle = ((s + i * (steps / n)) / steps) * 2 * Math.PI;
          wps.push([tx + r * Math.cos(angle), ty + r * Math.sin(angle), alt]);
        }
      }
      bb.backend.followPath(bb.droneIds[i], wps, resolveSpeed('fast')).catch(() => {});
    }
    return SUCCESS;
  },
});

/**
 * Set formation — reads bb.vars.formation (or params.formation).
 */
export const SetFormation = new Task({
  run(bb) {
    const shape = bb.vars?.formation || bb.params.formation || 'line';
    const spacing = bb.params.spacing || 5;
    try {
      const offsets = resolveFormation(shape, bb.droneIds.length, spacing);
      bb.backend.setFormation(offsets, bb.droneIds).catch(() => {});
      return SUCCESS;
    } catch {
      return FAILURE;
    }
  },
});

/**
 * Wait/delay — returns RUNNING for N ticks, then SUCCESS.
 * Reads bb.vars.waitTicks (default: 10 = 5 seconds at 500ms tick).
 */
export const Wait = new Task({
  start(bb) {
    bb._waitCounter = 0;
  },
  run(bb) {
    const target = bb.vars?.waitTicks || 10;
    bb._waitCounter = (bb._waitCounter || 0) + 1;
    if (bb._waitCounter >= target) {
      bb._waitCounter = 0;
      return SUCCESS;
    }
    return RUNNING;
  },
});

// ─── Action Registry ────────────────────────────────────────────────

export const ACTION_REGISTRY = {
  scanForTarget: ScanForTarget,
  updateTargetPosition: UpdateTargetPosition,
  detectAny: DetectAny,
  dispatchSearch: DispatchSearch,
  hoverAll: HoverAll,
  takeoffAll: TakeoffAll,
  landAll: LandAll,
  rtlAll: RtlAll,
  goToTarget: GoToTarget,
  surround: Surround,
  follow: Follow,
  intercept: Intercept,
  harass: Harass,
  setFormation: SetFormation,
  wait: Wait,
};
