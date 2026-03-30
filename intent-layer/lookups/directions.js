/**
 * Direction → Vector mappings
 * 
 * Body frame: forward/back/left/right relative to drone heading
 * Earth frame: north/south/east/west absolute
 */

// Body-relative directions (frame_id='base_link')
export const BODY_DIRECTIONS = {
  forward:  [1, 0, 0],
  back:     [-1, 0, 0],
  backward: [-1, 0, 0],
  left:     [0, 1, 0],
  right:    [0, -1, 0],
  up:       [0, 0, 1],
  down:     [0, 0, -1],
};

// Earth-fixed directions (frame_id='earth', ENU convention)
export const EARTH_DIRECTIONS = {
  north: [1, 0, 0],
  south: [-1, 0, 0],
  east:  [0, -1, 0],
  west:  [0, 1, 0],
  up:    [0, 0, 1],
  down:  [0, 0, -1],
};

// Speed presets (m/s)
export const SPEEDS = {
  crawl:  0.25,
  slow:   0.5,
  normal: 1.5,
  fast:   3.0,
  sprint: 5.0,
};

/**
 * Resolve direction string to vector and frame
 */
export function resolveDirection(direction) {
  const dir = direction.toLowerCase();
  
  if (BODY_DIRECTIONS[dir]) {
    return {
      vector: BODY_DIRECTIONS[dir],
      frame: 'base_link',
    };
  }
  
  if (EARTH_DIRECTIONS[dir]) {
    return {
      vector: EARTH_DIRECTIONS[dir],
      frame: 'earth',
    };
  }
  
  throw new Error(`Unknown direction: ${direction}`);
}

/**
 * Resolve speed preset to m/s
 */
export function resolveSpeed(speed) {
  if (typeof speed === 'number') return speed;
  if (!speed) return SPEEDS.normal;
  
  const preset = speed.toLowerCase();
  if (SPEEDS[preset]) return SPEEDS[preset];
  
  throw new Error(`Unknown speed preset: ${speed}`);
}

/**
 * Scale vector by distance
 */
export function scaleVector(vector, distance) {
  return vector.map(v => v * distance);
}
