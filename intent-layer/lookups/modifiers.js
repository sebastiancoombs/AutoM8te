/**
 * Modifiers — Dynamic movement patterns applied to formations
 * 
 * LLM defines modifiers using constrained building blocks.
 * System does all the math.
 */

// Built-in pattern generators
const PATTERNS = {
  sinusoidal: (t, amplitude, frequency, phase) => 
    amplitude * Math.sin(2 * Math.PI * frequency * t + phase),
  
  linear: (t, amplitude, frequency, phase) => 
    amplitude * ((t * frequency + phase) % 2 - 1),
  
  circular: (t, amplitude, frequency, phase) => ({
    x: amplitude * Math.cos(2 * Math.PI * frequency * t + phase),
    y: amplitude * Math.sin(2 * Math.PI * frequency * t + phase),
  }),
  
  pulse: (t, amplitude, frequency, phase) => 
    amplitude * (Math.sin(2 * Math.PI * frequency * t + phase) > 0 ? 1 : 0),
  
  sawtooth: (t, amplitude, frequency, phase) =>
    amplitude * (((t * frequency + phase) % 1) * 2 - 1),
  
  triangle: (t, amplitude, frequency, phase) =>
    amplitude * (Math.abs(((t * frequency + phase) % 1) * 4 - 2) - 1),
  
  random: (t, amplitude, frequency, phase) =>
    amplitude * (Math.random() * 2 - 1) * Math.sin(frequency * t),
};

// Axis mapping
const AXES = {
  lateral: [0, 1, 0],   // Y axis (side to side)
  vertical: [0, 0, 1],  // Z axis (up/down)
  forward: [1, 0, 0],   // X axis (forward/back)
  all: [1, 1, 1],       // All axes
};

// Timing modes
const TIMING = {
  sync: (droneIndex, totalDrones) => 0,
  staggered: (droneIndex, totalDrones, offset) => droneIndex * offset,
  reverse_stagger: (droneIndex, totalDrones, offset) => (totalDrones - 1 - droneIndex) * offset,
  center_out: (droneIndex, totalDrones, offset) => Math.abs(droneIndex - totalDrones / 2) * offset,
  random: (droneIndex, totalDrones) => Math.random() * Math.PI * 2,
  sequential: (droneIndex, totalDrones) => droneIndex * (Math.PI * 2 / totalDrones),
};

// Stored modifiers (built-in + user-defined)
const modifiers = new Map();

// Built-in modifiers
modifiers.set('snake', {
  name: 'snake',
  pattern: 'sinusoidal',
  axis: 'lateral',
  amplitude_m: 2,
  frequency_hz: 0.5,
  timing: 'staggered',
  phase_offset: 0.5,
});

modifiers.set('wave', {
  name: 'wave',
  pattern: 'sinusoidal',
  axis: 'vertical',
  amplitude_m: 1,
  frequency_hz: 0.3,
  timing: 'staggered',
  phase_offset: 0.3,
});

modifiers.set('pulse', {
  name: 'pulse',
  pattern: 'pulse',
  axis: 'vertical',
  amplitude_m: 0.5,
  frequency_hz: 1,
  timing: 'sync',
  phase_offset: 0,
});

modifiers.set('breathe', {
  name: 'breathe',
  pattern: 'sinusoidal',
  axis: 'all',
  amplitude_m: 0.3,
  frequency_hz: 0.2,
  timing: 'sync',
  phase_offset: 0,
});

modifiers.set('orbit', {
  name: 'orbit',
  pattern: 'circular',
  axis: 'lateral',  // XY plane
  amplitude_m: 1,
  frequency_hz: 0.25,
  timing: 'sequential',
  phase_offset: 0,
});

modifiers.set('weave', {
  name: 'weave',
  pattern: 'sinusoidal',
  axis: 'lateral',
  amplitude_m: 3,
  frequency_hz: 0.2,
  timing: 'center_out',
  phase_offset: Math.PI,
});

/**
 * Define a new modifier
 */
export function defineModifier(config) {
  const modifier = {
    name: config.name,
    pattern: config.pattern || 'sinusoidal',
    axis: config.axis || 'lateral',
    amplitude_m: config.amplitude_m ?? 1,
    frequency_hz: config.frequency_hz ?? 0.5,
    timing: config.timing || 'staggered',
    phase_offset: config.phase_offset ?? 0.5,
  };
  
  // Validate
  if (!PATTERNS[modifier.pattern]) {
    throw new Error(`Unknown pattern: ${modifier.pattern}. Available: ${Object.keys(PATTERNS).join(', ')}`);
  }
  if (!AXES[modifier.axis]) {
    throw new Error(`Unknown axis: ${modifier.axis}. Available: ${Object.keys(AXES).join(', ')}`);
  }
  if (!TIMING[modifier.timing]) {
    throw new Error(`Unknown timing: ${modifier.timing}. Available: ${Object.keys(TIMING).join(', ')}`);
  }
  
  modifiers.set(modifier.name, modifier);
  return modifier;
}

/**
 * Get a modifier by name
 */
export function getModifier(name) {
  return modifiers.get(name);
}

/**
 * List all available modifiers
 */
export function listModifiers() {
  return [...modifiers.keys()];
}

/**
 * Apply modifier to a position at time t
 * 
 * @param {string} modifierName 
 * @param {[number, number, number]} basePosition 
 * @param {number} t - current time in seconds
 * @param {number} droneIndex 
 * @param {number} totalDrones 
 * @returns {[number, number, number]} modified position
 */
export function applyModifier(modifierName, basePosition, t, droneIndex, totalDrones) {
  const mod = modifiers.get(modifierName);
  if (!mod) {
    return basePosition; // No modifier, return unchanged
  }
  
  const patternFn = PATTERNS[mod.pattern];
  const axis = AXES[mod.axis];
  const timingFn = TIMING[mod.timing];
  
  // Calculate phase for this drone
  const phase = timingFn(droneIndex, totalDrones, mod.phase_offset);
  
  // Get pattern value
  const patternValue = patternFn(t, mod.amplitude_m, mod.frequency_hz, phase);
  
  // Apply to position
  const result = [...basePosition];
  
  if (mod.pattern === 'circular') {
    // Circular returns {x, y}
    result[0] += patternValue.x * axis[0];
    result[1] += patternValue.y * axis[1];
  } else {
    // Other patterns return single value
    result[0] += patternValue * axis[0];
    result[1] += patternValue * axis[1];
    result[2] += patternValue * axis[2];
  }
  
  return result;
}

/**
 * Apply modifier to entire formation
 * 
 * @param {string} modifierName 
 * @param {Array<{id: string, offset: [number, number, number]}>} offsets 
 * @param {number} t - current time
 * @returns {Array<{id: string, offset: [number, number, number]}>}
 */
export function applyModifierToFormation(modifierName, offsets, t) {
  if (!modifierName || !modifiers.has(modifierName)) {
    return offsets;
  }
  
  const totalDrones = offsets.length;
  
  return offsets.map((drone, index) => ({
    id: drone.id,
    offset: applyModifier(modifierName, drone.offset, t, index, totalDrones),
  }));
}

// Export constants for tool schemas
export const PATTERN_TYPES = Object.keys(PATTERNS);
export const AXIS_TYPES = Object.keys(AXES);
export const TIMING_TYPES = Object.keys(TIMING);
