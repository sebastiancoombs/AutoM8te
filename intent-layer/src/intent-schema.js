export const ALLOWED_OPERATIONS = new Set([
  'navigate_to',
  'compute_path',
  'follow_path',
  'wait',
  'backup',
  'spin',
  'hold_position',
  'goal_updated',
  'goal_reached',
  'is_battery_low',
  'clear_costmap',
]);

export const ALLOWED_STRUCTURAL_TYPES = new Set([
  'sequence',
  'fallback',
  'retry',
  'repeat',
  'guard',
  'timeout',
]);

export const OPERATION_REQUIREMENTS = {
  navigate_to: ['goal'],
  compute_path: ['goal'],
  follow_path: [],
  wait: ['duration_s'],
  backup: ['distance_m'],
  spin: ['angle_rad'],
  hold_position: [],
  goal_updated: [],
  goal_reached: [],
  is_battery_low: ['threshold'],
  clear_costmap: ['scope'],
};

export function validateIntentDocument(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['Intent must be an object'] };
  }

  if (doc.version !== 'v1') errors.push('version must be "v1"');
  if (!doc.actor || typeof doc.actor !== 'object' || !doc.actor.id) {
    errors.push('actor.id is required');
  }
  if (!['continuous', 'discrete'].includes(doc.mode)) {
    errors.push('mode must be "continuous" or "discrete"');
  }
  if (!doc.root) errors.push('root is required');

  if (doc.root) {
    walkNode(doc.root, 'root', errors, 0);
  }

  return { ok: errors.length === 0, errors };
}

function walkNode(node, path, errors, depth) {
  if (depth > 20) {
    errors.push(`${path}: maximum depth exceeded`);
    return;
  }
  if (!node || typeof node !== 'object') {
    errors.push(`${path}: node must be an object`);
    return;
  }

  if (node.type) {
    if (!ALLOWED_STRUCTURAL_TYPES.has(node.type)) {
      errors.push(`${path}: unsupported structural type ${node.type}`);
      return;
    }
    switch (node.type) {
      case 'sequence':
      case 'fallback': {
        if (!Array.isArray(node.children) || node.children.length === 0) {
          errors.push(`${path}: ${node.type} requires non-empty children[]`);
          return;
        }
        node.children.forEach((child, i) => walkNode(child, `${path}.children[${i}]`, errors, depth + 1));
        return;
      }
      case 'retry':
        if (typeof node.times !== 'number' || node.times < 1) {
          errors.push(`${path}: retry.times must be >= 1`);
        }
        if (!node.child) errors.push(`${path}: retry requires child`);
        else walkNode(node.child, `${path}.child`, errors, depth + 1);
        return;
      case 'repeat':
        if (!node.child) errors.push(`${path}: repeat requires child`);
        else walkNode(node.child, `${path}.child`, errors, depth + 1);
        return;
      case 'guard':
        if (!node.condition) errors.push(`${path}: guard requires condition`);
        else walkNode(node.condition, `${path}.condition`, errors, depth + 1);
        if (!node.child) errors.push(`${path}: guard requires child`);
        else walkNode(node.child, `${path}.child`, errors, depth + 1);
        return;
      case 'timeout':
        if (typeof node.duration_s !== 'number' || node.duration_s <= 0) {
          errors.push(`${path}: timeout.duration_s must be > 0`);
        }
        if (!node.child) errors.push(`${path}: timeout requires child`);
        else walkNode(node.child, `${path}.child`, errors, depth + 1);
        return;
    }
  }

  if (node.op) {
    if (!ALLOWED_OPERATIONS.has(node.op)) {
      errors.push(`${path}: unsupported op ${node.op}`);
      return;
    }
    for (const req of OPERATION_REQUIREMENTS[node.op] || []) {
      if (node[req] === undefined) errors.push(`${path}: ${node.op} requires ${req}`);
    }
    return;
  }

  errors.push(`${path}: node must contain either type or op`);
}
