/**
 * Group & Task Management for Drone Swarm
 * 
 * Tracks which drones are in which groups, what task each group is doing,
 * and provides context summaries.
 */

/**
 * @typedef {Object} DroneTask
 * @property {string} type - Task type (idle, moving, following, searching, hovering, etc.)
 * @property {string} [target] - Target if following
 * @property {string} [pattern] - Pattern if searching
 * @property {number} [progress] - Progress 0-100 if applicable
 * @property {number} startedAt - Timestamp when task started
 */

/**
 * @typedef {Object} Group
 * @property {string} name - Group name
 * @property {Set<string>} drones - Drone IDs in this group
 * @property {string} formation - Current formation
 * @property {number} spacing - Formation spacing in meters
 * @property {DroneTask} task - Current task
 */

export class GroupManager {
  constructor() {
    /** @type {Map<string, Group>} */
    this.groups = new Map();
    
    /** @type {Map<string, string>} drone_id -> group_name */
    this.droneToGroup = new Map();
    
    /** @type {Map<string, DroneTask>} drone_id -> individual task (if not in group) */
    this.individualTasks = new Map();
    
    // Create default idle group
    this.groups.set('idle', {
      name: 'idle',
      drones: new Set(),
      formation: 'none',
      spacing: 5,
      task: { type: 'standby', startedAt: Date.now() },
    });
  }

  /**
   * Initialize with drone IDs - all start in idle
   */
  initialize(droneIds) {
    const idleGroup = this.groups.get('idle');
    for (const id of droneIds) {
      idleGroup.drones.add(id);
      this.droneToGroup.set(id, 'idle');
    }
  }

  /**
   * Assign drones to a group (creates group if doesn't exist)
   */
  assign(droneIds, groupName) {
    // Create group if needed
    if (!this.groups.has(groupName)) {
      this.groups.set(groupName, {
        name: groupName,
        drones: new Set(),
        formation: 'none',
        spacing: 5,
        task: { type: 'idle', startedAt: Date.now() },
      });
    }

    const targetGroup = this.groups.get(groupName);

    for (const droneId of droneIds) {
      // Remove from current group
      const currentGroupName = this.droneToGroup.get(droneId);
      if (currentGroupName) {
        const currentGroup = this.groups.get(currentGroupName);
        if (currentGroup) {
          currentGroup.drones.delete(droneId);
          // Clean up empty groups (except idle)
          if (currentGroup.drones.size === 0 && currentGroupName !== 'idle') {
            this.groups.delete(currentGroupName);
          }
        }
      }

      // Add to new group
      targetGroup.drones.add(droneId);
      this.droneToGroup.set(droneId, groupName);
      
      // Clear individual task
      this.individualTasks.delete(droneId);
    }

    return targetGroup;
  }

  /**
   * Disband a group - all drones return to idle
   */
  disband(groupName) {
    if (groupName === 'idle') return; // Can't disband idle
    
    const group = this.groups.get(groupName);
    if (!group) return;

    const droneIds = [...group.drones];
    this.assign(droneIds, 'idle');
    this.groups.delete(groupName);
    
    return droneIds;
  }

  /**
   * Set group task
   */
  setGroupTask(groupName, task) {
    const group = this.groups.get(groupName);
    if (!group) return;
    
    group.task = {
      ...task,
      startedAt: Date.now(),
    };
  }

  /**
   * Set group formation
   */
  setGroupFormation(groupName, formation, spacing = 5) {
    const group = this.groups.get(groupName);
    if (!group) return;
    
    group.formation = formation;
    group.spacing = spacing;
  }

  /**
   * Set individual drone task (for drones doing solo ops)
   */
  setDroneTask(droneId, task) {
    this.individualTasks.set(droneId, {
      ...task,
      startedAt: Date.now(),
    });
  }

  /**
   * Get group by name
   */
  getGroup(groupName) {
    return this.groups.get(groupName);
  }

  /**
   * Get group for a drone
   */
  getDroneGroup(droneId) {
    const groupName = this.droneToGroup.get(droneId);
    return groupName ? this.groups.get(groupName) : null;
  }

  /**
   * Get all drones in a group
   */
  getDronesInGroup(groupName) {
    const group = this.groups.get(groupName);
    return group ? [...group.drones] : [];
  }

  /**
   * Resolve target - returns array of drone IDs
   * @param {Object} options
   * @param {string} [options.group] - Group name
   * @param {string} [options.drone_id] - Single drone
   * @param {string[]} [options.drones] - Multiple drones
   * @returns {string[]} Array of drone IDs
   */
  resolveTarget(options = {}) {
    if (options.drone_id) {
      return [options.drone_id];
    }
    if (options.drones) {
      return options.drones;
    }
    if (options.group) {
      return this.getDronesInGroup(options.group);
    }
    // Default: all non-idle drones, or all drones if all idle
    const active = [];
    for (const [name, group] of this.groups) {
      if (name !== 'idle') {
        active.push(...group.drones);
      }
    }
    if (active.length > 0) return active;
    
    // All idle - return all drones
    return this.getDronesInGroup('idle');
  }

  /**
   * Get full context summary for LLM
   */
  getContextSummary(dronePositions = new Map()) {
    const summary = {
      total: this.droneToGroup.size,
      groups: {},
    };

    for (const [name, group] of this.groups) {
      if (group.drones.size === 0) continue;

      // Calculate group center if positions available
      let center = null;
      if (dronePositions.size > 0) {
        const positions = [...group.drones]
          .map(id => dronePositions.get(id))
          .filter(p => p);
        if (positions.length > 0) {
          center = [
            positions.reduce((s, p) => s + p[0], 0) / positions.length,
            positions.reduce((s, p) => s + p[1], 0) / positions.length,
            positions.reduce((s, p) => s + p[2], 0) / positions.length,
          ].map(n => Math.round(n * 10) / 10);
        }
      }

      summary.groups[name] = {
        count: group.drones.size,
        drones: [...group.drones],
        formation: group.formation,
        task: this._formatTask(group.task),
        center,
      };
    }

    // Add individual tasks
    for (const [droneId, task] of this.individualTasks) {
      const groupName = this.droneToGroup.get(droneId);
      if (groupName && summary.groups[groupName]) {
        if (!summary.groups[groupName].individualTasks) {
          summary.groups[groupName].individualTasks = {};
        }
        summary.groups[groupName].individualTasks[droneId] = this._formatTask(task);
      }
    }

    return summary;
  }

  /**
   * Get human-readable context string
   */
  getContextString(dronePositions = new Map(), detectedObjects = []) {
    const ctx = this.getContextSummary(dronePositions);
    const lines = [`📍 Swarm (${ctx.total} drones):`];

    for (const [name, group] of Object.entries(ctx.groups)) {
      const pos = group.center ? ` at [${group.center.join(', ')}]` : '';
      const form = group.formation !== 'none' ? ` in ${group.formation}` : '';
      lines.push(`  ${name} (${group.count}): ${group.task}${form}${pos}`);
      
      if (group.individualTasks) {
        for (const [droneId, task] of Object.entries(group.individualTasks)) {
          lines.push(`    └─ ${droneId}: ${task}`);
        }
      }
    }

    if (detectedObjects.length > 0) {
      lines.push('');
      lines.push('👁️ Detected:');
      for (const obj of detectedObjects.slice(0, 5)) { // Limit to 5
        const dist = obj.distance_m ? `${obj.distance_m.toFixed(0)}m ${obj.direction}` : `at [${obj.position.map(p => p.toFixed(0)).join(', ')}]`;
        const moving = obj.velocity ? ` (moving ${obj.speed?.toFixed(1) || '?'}m/s)` : '';
        lines.push(`  ${obj.class}: ${dist}${moving}`);
      }
    }

    return lines.join('\n');
  }

  _formatTask(task) {
    if (!task) return 'unknown';
    
    switch (task.type) {
      case 'standby':
      case 'idle':
        return 'standby';
      case 'moving':
        return `moving ${task.direction || ''} ${task.distance_m || ''}m`.trim();
      case 'following':
        return `following ${task.target}`;
      case 'searching':
        const progress = task.progress ? ` (${task.progress}%)` : '';
        return `searching ${task.area || task.pattern || ''}${progress}`.trim();
      case 'hovering':
        return 'hovering';
      case 'landing':
        return 'landing';
      case 'returning':
        return 'returning to base';
      default:
        return task.type;
    }
  }

  /**
   * List all groups
   */
  listGroups() {
    return [...this.groups.keys()].filter(name => {
      const group = this.groups.get(name);
      return group && group.drones.size > 0;
    });
  }
}
