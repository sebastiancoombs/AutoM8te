/**
 * Shape System — Math-based formation creator
 * 
 * LLM provides math formulas (parametric, polar, bezier, etc.)
 * System evaluates curves, samples points, assigns drones.
 * Saved shapes become reusable formations.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { evaluate } from 'mathjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = join(__dirname, '..', 'data', 'shapes.json');

// --- Curve Evaluators ---

/**
 * Sample points along a parametric curve: x(t), y(t)
 */
function sampleParametric(curve, numPoints) {
  const { x: xExpr, y: yExpr, t: tRange } = curve;
  const [tMin, tMax] = tRange || [0, 2 * Math.PI];
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const t = tMin + (i / (numPoints - 1 || 1)) * (tMax - tMin);
    const x = evalMathExpr(xExpr, { t });
    const y = evalMathExpr(yExpr, { t });
    if (isFinite(x) && isFinite(y)) {
      points.push([x, y, 0]);
    }
  }
  return points;
}

/**
 * Sample points along a polar curve: r(theta)
 */
function samplePolar(curve, numPoints) {
  const { r: rExpr, theta: thetaRange } = curve;
  const [tMin, tMax] = thetaRange || [0, 2 * Math.PI];
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const theta = tMin + (i / (numPoints - 1 || 1)) * (tMax - tMin);
    const r = evalMathExpr(rExpr, { theta, t: theta });
    if (isFinite(r)) {
      points.push([r * Math.cos(theta), r * Math.sin(theta), 0]);
    }
  }
  return points;
}

/**
 * Sample points along a circle
 */
function sampleCircle(curve, numPoints) {
  const { radius, center } = curve;
  const [cx, cy] = center || [0, 0];
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), 0]);
  }
  return points;
}

/**
 * Sample points along an arc
 */
function sampleArc(curve, numPoints) {
  const { radius, center, start_angle, end_angle } = curve;
  const [cx, cy] = center || [0, 0];
  const startRad = (start_angle || 0) * Math.PI / 180;
  const endRad = (end_angle || 360) * Math.PI / 180;
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const angle = startRad + (i / (numPoints - 1 || 1)) * (endRad - startRad);
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), 0]);
  }
  return points;
}

/**
 * Sample points along a line segment
 */
function sampleLine(curve, numPoints) {
  const { start, end } = curve;
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1 || 1);
    points.push([
      start[0] + t * (end[0] - start[0]),
      start[1] + t * (end[1] - start[1]),
      0,
    ]);
  }
  return points;
}

/**
 * Sample points along a cubic Bezier curve (or chain of bezier segments)
 */
function sampleBezier(curve, numPoints) {
  const { points: controlPoints } = curve;
  if (!controlPoints || controlPoints.length < 2) return [];

  // For a simple polyline through control points, use De Casteljau
  const result = [];
  const n = controlPoints.length - 1;

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1 || 1);
    // De Casteljau's algorithm
    let pts = controlPoints.map(p => [...p]);
    for (let k = 1; k <= n; k++) {
      for (let j = 0; j <= n - k; j++) {
        pts[j] = [
          (1 - t) * pts[j][0] + t * pts[j + 1][0],
          (1 - t) * pts[j][1] + t * pts[j + 1][1],
        ];
      }
    }
    result.push([pts[0][0], pts[0][1], 0]);
  }
  return result;
}

// --- Curve Router ---

const CURVE_SAMPLERS = {
  parametric: sampleParametric,
  polar: samplePolar,
  circle: sampleCircle,
  arc: sampleArc,
  line: sampleLine,
  bezier: sampleBezier,
};

function sampleCurve(curve, numPoints) {
  const sampler = CURVE_SAMPLERS[curve.equation];
  if (!sampler) {
    throw new Error(`Unknown curve type: ${curve.equation}. Available: ${Object.keys(CURVE_SAMPLERS).join(', ')}`);
  }
  return sampler(curve, numPoints);
}

// --- Math Expression Evaluator (mathjs) ---

function evalMathExpr(expr, vars) {
  try {
    return evaluate(expr, vars);
  } catch {
    return NaN;
  }
}

// --- Point Distribution ---

/**
 * Given multiple curves, distribute N drones across them
 * proportional to each curve's approximate length
 */
function distributeDrones(curves, totalDrones, scale = 1) {
  // Sample each curve densely to estimate length
  const curveLengths = curves.map(curve => {
    const pts = sampleCurve(curve, 100);
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  });

  const totalLength = curveLengths.reduce((a, b) => a + b, 0);
  if (totalLength === 0) return [];

  // Distribute drones proportionally, minimum 1 per curve
  let dronesPerCurve = curves.map((_, i) => {
    return Math.max(1, Math.round((curveLengths[i] / totalLength) * totalDrones));
  });

  // Adjust to match exact total
  let assigned = dronesPerCurve.reduce((a, b) => a + b, 0);
  while (assigned > totalDrones) {
    const longest = dronesPerCurve.indexOf(Math.max(...dronesPerCurve));
    dronesPerCurve[longest]--;
    assigned--;
  }
  while (assigned < totalDrones) {
    const longest = curveLengths.indexOf(Math.max(...curveLengths));
    dronesPerCurve[longest]++;
    assigned++;
  }

  // Sample final points
  const allPoints = [];
  for (let i = 0; i < curves.length; i++) {
    const pts = sampleCurve(curves[i], dronesPerCurve[i]);
    allPoints.push(...pts);
  }

  // Apply scale and center
  const cx = allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length;
  const cy = allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length;

  return allPoints.map((p, i) => ({
    id: `drone${i}`,
    offset: [
      (p[0] - cx) * scale,
      (p[1] - cy) * scale,
      p[2] * scale,
    ],
  }));
}

// --- Shape Library ---

let shapeLibrary = {};

function loadLibrary() {
  try {
    if (existsSync(LIBRARY_PATH)) {
      shapeLibrary = JSON.parse(readFileSync(LIBRARY_PATH, 'utf-8'));
    }
  } catch {
    shapeLibrary = {};
  }
}

function saveLibrary() {
  const dir = dirname(LIBRARY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LIBRARY_PATH, JSON.stringify(shapeLibrary, null, 2));
}

// Load on import
loadLibrary();

/**
 * Create a new shape from curves and optionally save it
 */
export function createShape(name, curves, options = {}) {
  const { scale = 1, save = true } = options;

  // Validate curves by sampling
  for (const curve of curves) {
    const test = sampleCurve(curve, 5);
    if (test.length === 0) {
      throw new Error(`Curve "${curve.equation}" produced no valid points`);
    }
  }

  const shape = {
    name,
    curves,
    scale,
    created: new Date().toISOString(),
  };

  if (save) {
    shapeLibrary[name.toLowerCase()] = shape;
    saveLibrary();
  }

  return shape;
}

/**
 * Get a saved shape
 */
export function getShape(name) {
  return shapeLibrary[name.toLowerCase()] || null;
}

/**
 * List all saved shapes
 */
export function listShapes() {
  return Object.keys(shapeLibrary);
}

/**
 * Delete a saved shape
 */
export function deleteShape(name) {
  const key = name.toLowerCase();
  if (shapeLibrary[key]) {
    delete shapeLibrary[key];
    saveLibrary();
    return true;
  }
  return false;
}

/**
 * Resolve a shape to drone offsets (like resolveFormation)
 */
export function resolveShape(name, droneCount, scale = 1) {
  const shape = getShape(name);
  if (!shape) return null;
  return distributeDrones(shape.curves, droneCount, scale * (shape.scale || 1));
}

/**
 * Resolve arbitrary curves to drone offsets (for one-off shapes)
 */
export function resolveCurves(curves, droneCount, scale = 1) {
  return distributeDrones(curves, droneCount, scale);
}

// Export for testing
export { sampleCurve, evalMathExpr, distributeDrones, CURVE_SAMPLERS };
