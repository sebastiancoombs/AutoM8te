/**
 * Search patterns → Waypoint generators
 * 
 * Each returns array of [x, y, z] waypoints relative to start position
 */

/**
 * Grid/lawnmower search pattern
 * @param {number} width - search area width (m)
 * @param {number} height - search area height (m)
 * @param {number} spacing - track spacing (m)
 * @param {number} altitude - flight altitude (m)
 */
export function gridWaypoints(width, height, spacing, altitude = 10) {
  const waypoints = [];
  const tracks = Math.ceil(height / spacing);
  
  for (let i = 0; i <= tracks; i++) {
    const y = i * spacing;
    const x1 = i % 2 === 0 ? 0 : width;
    const x2 = i % 2 === 0 ? width : 0;
    
    waypoints.push([x1, y, altitude]);
    waypoints.push([x2, y, altitude]);
  }
  return waypoints;
}

/**
 * Spiral search pattern (outward from center)
 * @param {number} maxRadius - maximum radius (m)
 * @param {number} spacing - distance between spiral arms (m)
 * @param {number} altitude - flight altitude (m)
 */
export function spiralWaypoints(maxRadius, spacing, altitude = 10) {
  const waypoints = [];
  const totalRotations = maxRadius / spacing;
  const pointsPerRotation = 12;
  const totalPoints = Math.ceil(totalRotations * pointsPerRotation);
  
  for (let i = 0; i < totalPoints; i++) {
    const angle = (i / pointsPerRotation) * 2 * Math.PI;
    const radius = (i / totalPoints) * maxRadius;
    waypoints.push([
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      altitude,
    ]);
  }
  return waypoints;
}

/**
 * Expanding square search pattern
 * @param {number} maxSize - maximum square size (m)
 * @param {number} spacing - expansion increment (m)
 * @param {number} altitude - flight altitude (m)
 */
export function expandingSquareWaypoints(maxSize, spacing, altitude = 10) {
  const waypoints = [[0, 0, altitude]];
  let size = spacing;
  let x = 0, y = 0;
  
  while (size <= maxSize) {
    // Right
    x += size;
    waypoints.push([x, y, altitude]);
    
    // Down
    y -= size;
    waypoints.push([x, y, altitude]);
    
    size += spacing;
    
    // Left
    x -= size;
    waypoints.push([x, y, altitude]);
    
    // Up
    y += size;
    waypoints.push([x, y, altitude]);
    
    size += spacing;
  }
  return waypoints;
}

/**
 * Sector search (pie slice)
 * @param {number} radius - sector radius (m)
 * @param {number} angle - sector angle (degrees)
 * @param {number} tracks - number of radial tracks
 * @param {number} altitude - flight altitude (m)
 */
export function sectorWaypoints(radius, angle, tracks, altitude = 10) {
  const waypoints = [];
  const angleRad = (angle * Math.PI) / 180;
  const startAngle = -angleRad / 2;
  const angleStep = angleRad / (tracks - 1);
  
  for (let i = 0; i < tracks; i++) {
    const a = startAngle + i * angleStep;
    if (i % 2 === 0) {
      waypoints.push([0, 0, altitude]);
      waypoints.push([radius * Math.cos(a), radius * Math.sin(a), altitude]);
    } else {
      waypoints.push([radius * Math.cos(a), radius * Math.sin(a), altitude]);
      waypoints.push([0, 0, altitude]);
    }
  }
  return waypoints;
}

/**
 * Parallel track search
 * @param {number} length - track length (m)
 * @param {number} tracks - number of tracks
 * @param {number} spacing - track spacing (m)
 * @param {number} altitude - flight altitude (m)
 */
export function parallelWaypoints(length, tracks, spacing, altitude = 10) {
  const waypoints = [];
  const startY = -((tracks - 1) * spacing) / 2;
  
  for (let i = 0; i < tracks; i++) {
    const y = startY + i * spacing;
    if (i % 2 === 0) {
      waypoints.push([0, y, altitude]);
      waypoints.push([length, y, altitude]);
    } else {
      waypoints.push([length, y, altitude]);
      waypoints.push([0, y, altitude]);
    }
  }
  return waypoints;
}

// Pattern registry
export const PATTERNS = {
  grid:             gridWaypoints,
  lawnmower:        gridWaypoints,
  spiral:           spiralWaypoints,
  expanding:        expandingSquareWaypoints,
  expanding_square: expandingSquareWaypoints,
  sector:           sectorWaypoints,
  parallel:         parallelWaypoints,
};

/**
 * Resolve pattern name to waypoints
 */
export function resolvePattern(name, params) {
  const fn = PATTERNS[name.toLowerCase()];
  if (!fn) {
    throw new Error(`Unknown pattern: ${name}. Available: ${Object.keys(PATTERNS).join(', ')}`);
  }
  
  // Extract common params with defaults
  const {
    width = 50,
    height = 50,
    radius = 50,
    spacing = 10,
    altitude = 10,
    tracks = 5,
    angle = 90,
    length = 50,
  } = params || {};
  
  switch (name.toLowerCase()) {
    case 'grid':
    case 'lawnmower':
      return fn(width, height, spacing, altitude);
    case 'spiral':
      return fn(radius, spacing, altitude);
    case 'expanding':
    case 'expanding_square':
      return fn(radius, spacing, altitude);
    case 'sector':
      return fn(radius, angle, tracks, altitude);
    case 'parallel':
      return fn(length, tracks, spacing, altitude);
    default:
      return fn(width, height, spacing, altitude);
  }
}
