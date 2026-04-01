/**
 * Path Planner — Convert shape keyframes into per-drone waypoint paths
 * 
 * Instead of a central animation loop, each drone gets its own
 * waypoint array with timing and easing. Fire and forget.
 * 
 * Input:  keyframes (shape at different times) or animated shape (time-based curves)
 * Output: per-drone path = [{position, time_s, easing}, ...]
 */

import { Easing } from '@tweenjs/tween.js';
import flubber from 'flubber';
const { interpolate } = flubber;
import { resolveCurves } from '../lookups/shapes.js';

// --- Easing Presets ---

const EASING_MAP = {
  linear: Easing.Linear.None,
  inOut: Easing.Quadratic.InOut,
  in: Easing.Quadratic.In,
  out: Easing.Quadratic.Out,
  elastic: Easing.Elastic.InOut,
  bounce: Easing.Bounce.Out,
  cubic: Easing.Cubic.InOut,
  expo: Easing.Exponential.InOut,
};

function getEasing(name) {
  return EASING_MAP[name] || EASING_MAP.inOut;
}

// --- Core: Generate per-drone waypoint paths ---

/**
 * Given an array of keyframes (each with curves at a point in time),
 * generate a waypoint path for each drone.
 * 
 * @param {Array} keyframes - [{at: 0, curves: [...]}, {at: 1.0, curves: [...]}]
 * @param {number} droneCount - number of drones
 * @param {object} options - {duration_s, loop, easing, scale, samplesPerSegment}
 * @returns {Map<string, Array>} droneId → [{position: [x,y,z], time_s, easing}]
 */
export function planKeyframePaths(keyframes, droneCount, options = {}) {
  const {
    duration_s = 5,
    easing = 'inOut',
    scale = 1,
    samplesPerSegment = 10,
  } = options;

  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);

  // Resolve each keyframe into drone positions
  const snapshots = sorted.map(kf => ({
    time: kf.at * duration_s,
    positions: resolveCurves(kf.curves, droneCount, scale).map(d => d.offset),
  }));

  // Build per-drone paths
  const paths = new Map();
  const easingFn = getEasing(easing);

  for (let d = 0; d < droneCount; d++) {
    const droneId = `drone${d}`;
    const waypoints = [];

    for (let s = 0; s < snapshots.length; s++) {
      const snap = snapshots[s];
      const pos = snap.positions[d] || [0, 0, 0];

      if (s === 0) {
        // First keyframe — just set position
        waypoints.push({
          position: pos,
          time_s: snap.time,
          easing: 'linear',
        });
      } else {
        // Interpolate between previous and current
        const prev = snapshots[s - 1];
        const prevPos = prev.positions[d] || [0, 0, 0];
        const dt = snap.time - prev.time;

        // Add intermediate samples for smooth motion
        for (let i = 1; i <= samplesPerSegment; i++) {
          const t = i / samplesPerSegment;
          const easedT = easingFn(t);

          waypoints.push({
            position: [
              prevPos[0] + (pos[0] - prevPos[0]) * easedT,
              prevPos[1] + (pos[1] - prevPos[1]) * easedT,
              prevPos[2] + (pos[2] - prevPos[2]) * easedT,
            ],
            time_s: prev.time + dt * t,
            easing: easing,
          });
        }
      }
    }

    paths.set(droneId, waypoints);
  }

  return paths;
}

/**
 * Generate paths from a time-animated shape (curves with `time` variable).
 * Samples the shape at regular intervals and builds per-drone paths.
 * 
 * @param {Array} curves - curve definitions (with `time` variable in formulas)
 * @param {number} droneCount
 * @param {object} options - {duration_s, fps, scale, easing}
 * @returns {Map<string, Array>} droneId → [{position, time_s, easing}]
 */
export function planAnimatedPaths(curves, droneCount, options = {}) {
  const {
    duration_s = 5,
    fps = 10,
    scale = 1,
    easing = 'linear',
  } = options;

  const totalFrames = Math.ceil(duration_s * fps);
  const paths = new Map();

  // Initialize drone paths
  for (let d = 0; d < droneCount; d++) {
    paths.set(`drone${d}`, []);
  }

  // Sample at each frame
  for (let f = 0; f <= totalFrames; f++) {
    const time = (f / totalFrames) * duration_s;
    const offsets = resolveCurves(curves, droneCount, scale, time);

    for (let d = 0; d < offsets.length; d++) {
      const droneId = offsets[d].id;
      const path = paths.get(droneId);
      if (path) {
        path.push({
          position: offsets[d].offset,
          time_s: time,
          easing: easing,
        });
      }
    }
  }

  return paths;
}

/**
 * Generate a motion path — move an entire shape along a trajectory.
 * Returns per-drone paths where each drone maintains its offset
 * while the whole formation follows the motion path.
 * 
 * @param {Array} shapeOffsets - [{id, offset: [x,y,z]}, ...] from resolveCurves
 * @param {object} motion - {path, radius_m, duration_s, rotate_with_path}
 * @param {object} options - {fps, easing}
 * @returns {Map<string, Array>} droneId → [{position, time_s, easing}]
 */
export function planMotionPath(shapeOffsets, motion, options = {}) {
  const {
    fps = 10,
    easing = 'linear',
  } = options;

  const duration = motion.duration_s || 10;
  const totalFrames = Math.ceil(duration * fps);
  const paths = new Map();

  for (const drone of shapeOffsets) {
    paths.set(drone.id, []);
  }

  for (let f = 0; f <= totalFrames; f++) {
    const t = f / totalFrames;
    const time_s = t * duration;

    // Calculate center position along motion path
    let cx = 0, cy = 0, cz = 0;
    let heading = 0; // radians

    switch (motion.path) {
      case 'circle': {
        const r = motion.radius_m || 20;
        const angle = t * 2 * Math.PI;
        cx = r * Math.cos(angle);
        cy = r * Math.sin(angle);
        heading = angle + Math.PI / 2; // tangent direction
        break;
      }
      case 'line': {
        const dist = motion.distance_m || 50;
        const dir = motion.direction || 'north';
        const dirs = { north: [1, 0], south: [-1, 0], east: [0, 1], west: [0, -1] };
        const [dx, dy] = dirs[dir] || [1, 0];
        cx = dx * dist * t;
        cy = dy * dist * t;
        heading = Math.atan2(dy, dx);
        break;
      }
      case 'figure8': {
        const r = motion.radius_m || 20;
        const angle = t * 2 * Math.PI;
        cx = r * Math.sin(angle);
        cy = r * Math.sin(angle) * Math.cos(angle);
        heading = Math.atan2(
          Math.cos(angle) * (Math.cos(angle) * Math.cos(angle) - Math.sin(angle) * Math.sin(angle)),
          Math.cos(angle)
        );
        break;
      }
      default:
        break;
    }

    // Apply rotation if rotate_with_path
    const rotate = motion.rotate_with_path !== false;

    for (const drone of shapeOffsets) {
      let ox = drone.offset[0];
      let oy = drone.offset[1];
      const oz = drone.offset[2];

      if (rotate) {
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const rx = ox * cos - oy * sin;
        const ry = ox * sin + oy * cos;
        ox = rx;
        oy = ry;
      }

      paths.get(drone.id).push({
        position: [cx + ox, cy + oy, cz + oz],
        time_s,
        easing,
      });
    }
  }

  return paths;
}

/**
 * Convert per-drone paths into backend-ready waypoint arrays.
 * Strips metadata, returns just position arrays per drone.
 * Also calculates speed between waypoints.
 * 
 * @param {Map<string, Array>} paths
 * @returns {Map<string, {waypoints: Array, speeds: Array}>}
 */
export function pathsToWaypoints(paths) {
  const result = new Map();

  for (const [droneId, path] of paths) {
    const waypoints = [];
    const speeds = [];

    for (let i = 0; i < path.length; i++) {
      waypoints.push(path[i].position);

      if (i > 0) {
        const prev = path[i - 1];
        const curr = path[i];
        const dt = curr.time_s - prev.time_s;
        if (dt > 0) {
          const dx = curr.position[0] - prev.position[0];
          const dy = curr.position[1] - prev.position[1];
          const dz = curr.position[2] - prev.position[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          speeds.push(dist / dt);
        } else {
          speeds.push(5); // default
        }
      }
    }

    result.set(droneId, { waypoints, speeds });
  }

  return result;
}

export { EASING_MAP, getEasing };
