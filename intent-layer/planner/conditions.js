/**
 * Behavior Tree Condition Nodes
 * 
 * Pure checks — read blackboard state, return SUCCESS or FAILURE.
 * No side effects.
 */

import { Task, SUCCESS, FAILURE } from 'behaviortree';

/**
 * Is target currently tracked? (targetPosition exists and is recent)
 */
export const HasTarget = new Task({
  run(bb) {
    return bb.targetPosition ? SUCCESS : FAILURE;
  },
});

/**
 * Is target lost? (inverse of HasTarget)
 */
export const TargetLost = new Task({
  run(bb) {
    return bb.targetPosition ? FAILURE : SUCCESS;
  },
});

/**
 * Are there enough drones? Reads bb.vars.minDrones (default: 1).
 */
export const HasEnoughDrones = new Task({
  run(bb) {
    const min = bb.vars?.minDrones || 1;
    return bb.droneIds.length >= min ? SUCCESS : FAILURE;
  },
});

/**
 * Is any object of a specific class detected?
 * Reads bb.vars.checkClass.
 */
export const IsObjectDetected = new Task({
  run(bb) {
    const cls = bb.vars?.checkClass || bb.targetClass;
    const objects = bb.detector.getObjects();
    return objects.some(o => o.class === cls) ? SUCCESS : FAILURE;
  },
});

/**
 * Is the target within a certain distance of any drone?
 * Reads bb.vars.maxDistance (default: 30m).
 */
export const TargetInRange = new Task({
  async run(bb) {
    if (!bb.targetPosition) return FAILURE;
    const maxDist = bb.vars?.maxDistance || 30;
    const states = await bb.backend.getDroneStates();

    for (const id of bb.droneIds) {
      const s = states.get(id);
      if (!s) continue;
      const dx = s.position[0] - bb.targetPosition[0];
      const dy = s.position[1] - bb.targetPosition[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= maxDist) return SUCCESS;
    }
    return FAILURE;
  },
});

/**
 * Are all drones airborne?
 */
export const AllAirborne = new Task({
  async run(bb) {
    const states = await bb.backend.getDroneStates();
    for (const id of bb.droneIds) {
      const s = states.get(id);
      if (!s || s.position[2] < 1) return FAILURE;
    }
    return SUCCESS;
  },
});

/**
 * Custom variable check — reads bb.vars.key and compares to bb.vars.value.
 * Supports: eq, gt, lt, gte, lte, neq.
 * bb.vars.compare defaults to 'eq'.
 */
export const CheckVar = new Task({
  run(bb) {
    const key = bb.vars?.key;
    const expected = bb.vars?.value;
    const op = bb.vars?.compare || 'eq';
    if (!key) return FAILURE;

    const actual = bb.vars?.[key] ?? bb[key];
    if (actual === undefined) return FAILURE;

    switch (op) {
      case 'eq':  return actual === expected ? SUCCESS : FAILURE;
      case 'neq': return actual !== expected ? SUCCESS : FAILURE;
      case 'gt':  return actual > expected ? SUCCESS : FAILURE;
      case 'lt':  return actual < expected ? SUCCESS : FAILURE;
      case 'gte': return actual >= expected ? SUCCESS : FAILURE;
      case 'lte': return actual <= expected ? SUCCESS : FAILURE;
      default:    return FAILURE;
    }
  },
});

/**
 * Count detected objects of a class. Sets bb.vars.detectedCount.
 * Returns SUCCESS if count > 0, FAILURE if 0.
 */
export const CountDetected = new Task({
  run(bb) {
    const cls = bb.vars?.checkClass || bb.targetClass;
    const objects = bb.detector.getObjects();
    const count = objects.filter(o => o.class === cls).length;
    if (!bb.vars) bb.vars = {};
    bb.vars.detectedCount = count;
    return count > 0 ? SUCCESS : FAILURE;
  },
});

// ─── Condition Registry ─────────────────────────────────────────────

export const CONDITION_REGISTRY = {
  hasTarget: HasTarget,
  targetLost: TargetLost,
  hasEnoughDrones: HasEnoughDrones,
  isObjectDetected: IsObjectDetected,
  targetInRange: TargetInRange,
  allAirborne: AllAirborne,
  checkVar: CheckVar,
  countDetected: CountDetected,
};
