/**
 * Formation → Offset generators
 * 
 * Each returns array of {id, offset: [x, y, z]} for N drones
 * Offsets are relative to virtual centroid
 */

/**
 * Line formation: drones in a row
 * @param {number} count - number of drones
 * @param {number} spacing - distance between drones (m)
 * @param {string} axis - 'x' or 'y' (default 'y' = side by side)
 */
export function lineOffsets(count, spacing, axis = 'y') {
  const offsets = [];
  const totalWidth = (count - 1) * spacing;
  const startOffset = -totalWidth / 2;
  
  for (let i = 0; i < count; i++) {
    const pos = startOffset + i * spacing;
    offsets.push({
      id: `drone${i}`,
      offset: axis === 'x' ? [pos, 0, 0] : [0, pos, 0],
    });
  }
  return offsets;
}

/**
 * V formation: classic flying V
 * @param {number} count - number of drones
 * @param {number} spacing - distance between adjacent drones (m)
 */
export function vOffsets(count, spacing) {
  const offsets = [];
  const halfAngle = Math.PI / 6; // 30 degrees
  
  // Leader at front
  offsets.push({ id: 'drone0', offset: [0, 0, 0] });
  
  // Alternating left/right behind leader
  for (let i = 1; i < count; i++) {
    const side = i % 2 === 1 ? 1 : -1; // odd=right, even=left
    const rank = Math.ceil(i / 2);
    const x = -rank * spacing * Math.cos(halfAngle);
    const y = side * rank * spacing * Math.sin(halfAngle);
    offsets.push({ id: `drone${i}`, offset: [x, y, 0] });
  }
  return offsets;
}

/**
 * Circle/ring formation
 * @param {number} count - number of drones
 * @param {number} radius - circle radius (m)
 */
export function circleOffsets(count, radius) {
  const offsets = [];
  const angleStep = (2 * Math.PI) / count;
  
  for (let i = 0; i < count; i++) {
    const angle = i * angleStep;
    offsets.push({
      id: `drone${i}`,
      offset: [
        radius * Math.cos(angle),
        radius * Math.sin(angle),
        0,
      ],
    });
  }
  return offsets;
}

/**
 * Square/grid formation
 * @param {number} count - number of drones
 * @param {number} spacing - distance between drones (m)
 */
export function squareOffsets(count, spacing) {
  const offsets = [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const xStart = -((cols - 1) * spacing) / 2;
  const yStart = -((rows - 1) * spacing) / 2;
  
  let droneIndex = 0;
  for (let row = 0; row < rows && droneIndex < count; row++) {
    for (let col = 0; col < cols && droneIndex < count; col++) {
      offsets.push({
        id: `drone${droneIndex}`,
        offset: [xStart + col * spacing, yStart + row * spacing, 0],
      });
      droneIndex++;
    }
  }
  return offsets;
}

/**
 * Column formation: single file
 * @param {number} count - number of drones
 * @param {number} spacing - distance between drones (m)
 */
export function columnOffsets(count, spacing) {
  return lineOffsets(count, spacing, 'x');
}

/**
 * Echelon formation: diagonal line
 * @param {number} count - number of drones
 * @param {number} spacing - distance between drones (m)
 * @param {string} side - 'left' or 'right'
 */
export function echelonOffsets(count, spacing, side = 'right') {
  const offsets = [];
  const yDir = side === 'right' ? -1 : 1;
  
  for (let i = 0; i < count; i++) {
    offsets.push({
      id: `drone${i}`,
      offset: [-i * spacing * 0.7, i * spacing * 0.7 * yDir, 0],
    });
  }
  return offsets;
}

// Formation registry
export const FORMATIONS = {
  line:    lineOffsets,
  v:       vOffsets,
  circle:  circleOffsets,
  ring:    circleOffsets,
  square:  squareOffsets,
  grid:    squareOffsets,
  column:  columnOffsets,
  file:    columnOffsets,
  echelon: echelonOffsets,
};

/**
 * Resolve formation name to offsets
 */
export function resolveFormation(name, count, spacing) {
  const fn = FORMATIONS[name.toLowerCase()];
  if (!fn) {
    throw new Error(`Unknown formation: ${name}. Available: ${Object.keys(FORMATIONS).join(', ')}`);
  }
  return fn(count, spacing);
}
