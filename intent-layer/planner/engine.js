/**
 * Behavior Planner Engine
 * 
 * Bridges the intent layer and backend through composable behavior trees.
 * 
 * Key concepts:
 *   - Plans are behavior trees (BT) that tick on a loop
 *   - Each plan has a blackboard with backend refs, perception, state
 *   - Plans can be created from templates or custom JSON (LLM-generated)
 *   - Multiple plans can run concurrently (one per group/drone-set)
 *   - Plans react to perception events without LLM intervention
 * 
 * The LLM calls drone_plan to:
 *   1. Start a named template:  { action: "start", plan: "find_and_surround", target: "car" }
 *   2. Start a custom BT:       { action: "start", tree: { ...json BT definition... }, target: "person" }
 *   3. Stop a plan:             { action: "stop", plan_id: "p_001" }
 *   4. List running plans:      { action: "status" }
 */

import { BehaviorTree, Sequence, Selector, Task, Random,
         SUCCESS, FAILURE, RUNNING, decorators } from 'behaviortree';
import { ACTION_REGISTRY } from './actions.js';
import { CONDITION_REGISTRY } from './conditions.js';
import { TEMPLATES } from './templates.js';

const { InvertDecorator, CooldownDecorator, AlwaysSucceedDecorator, AlwaysFailDecorator } = decorators;

// ─── Register all actions + conditions as BT tasks ──────────────────

for (const [name, task] of Object.entries(ACTION_REGISTRY)) {
  BehaviorTree.register(name, task);
}
for (const [name, task] of Object.entries(CONDITION_REGISTRY)) {
  BehaviorTree.register(name, task);
}

// ─── JSON Tree Builder ──────────────────────────────────────────────

/**
 * Build a BT node tree from a JSON definition.
 * Supports: sequence, selector, parallel, random, repeat, invert,
 *           alwaysSucceed, alwaysFail, cooldown, and any registered task.
 */
function buildNode(def) {
  if (typeof def === 'string') {
    // Registered task name
    return def;
  }

  const { type, name, nodes, node } = def;

  switch (type) {
    case 'sequence':
      return new Sequence({
        name: name || 'sequence',
        nodes: (nodes || []).map(buildNode),
      });

    case 'selector':
      return new Selector({
        name: name || 'selector',
        nodes: (nodes || []).map(buildNode),
      });

    case 'random':
      return new Random({
        name: name || 'random',
        nodes: (nodes || []).map(buildNode),
      });

    case 'repeat': {
      // Repeat decorator — wraps a single child.
      // If no limit, repeats forever (returns RUNNING).
      const child = node ? buildNode(node) : (nodes ? buildNode(nodes[0]) : null);
      if (!child) throw new Error('repeat node needs a child (node or nodes[0])');
      const limit = def.repeat || def.times || Infinity;
      
      return new Task({
        name: name || 'repeat',
        start(bb) {
          bb._repeatCount = bb._repeatCount || {};
          bb._repeatCount[name || 'repeat'] = 0;
        },
        run(bb) {
          const key = name || 'repeat';
          const count = bb._repeatCount[key] || 0;
          if (count >= limit) {
            bb._repeatCount[key] = 0;
            return SUCCESS;
          }

          // Create a mini-tree for the child and step it
          const childTree = new BehaviorTree({
            tree: child,
            blackboard: bb,
          });
          childTree.step();
          
          // Check result — if the child returned SUCCESS, increment and keep going
          // If FAILURE, the repeat fails. If RUNNING, stay running.
          bb._repeatCount[key] = count + 1;
          if (limit === Infinity) return RUNNING;
          return bb._repeatCount[key] >= limit ? SUCCESS : RUNNING;
        },
      });
    }

    case 'invert':
      return new InvertDecorator({
        name: name || 'invert',
        node: node ? buildNode(node) : buildNode(nodes[0]),
      });

    case 'alwaysSucceed':
      return new AlwaysSucceedDecorator({
        name: name || 'alwaysSucceed',
        node: node ? buildNode(node) : buildNode(nodes[0]),
      });

    case 'alwaysFail':
      return new AlwaysFailDecorator({
        name: name || 'alwaysFail',
        node: node ? buildNode(node) : buildNode(nodes[0]),
      });

    case 'cooldown':
      return new CooldownDecorator({
        name: name || 'cooldown',
        cooldown: def.cooldown || 5000,
        node: node ? buildNode(node) : buildNode(nodes[0]),
      });

    default: {
      // Must be a registered task name
      const registered = BehaviorTree.getNode?.(type);
      if (registered) return type; // Return string ref — BT resolves it
      
      // Check our registries directly
      if (ACTION_REGISTRY[type] || CONDITION_REGISTRY[type]) {
        return type; // Return string ref
      }

      throw new Error(`Unknown BT node type: "${type}". Available actions: ${Object.keys(ACTION_REGISTRY).join(', ')}. Conditions: ${Object.keys(CONDITION_REGISTRY).join(', ')}`);
    }
  }
}

// ─── Plan Instance ──────────────────────────────────────────────────

let planCounter = 0;

class Plan {
  constructor(treeDef, config) {
    this.id = `p_${String(++planCounter).padStart(3, '0')}`;
    this.name = config.name || treeDef.name || 'unnamed';
    this.startedAt = Date.now();
    this._stopped = false;
    this._tickInterval = null;

    // Build the blackboard
    this.blackboard = {
      backend: config.backend,
      detector: config.detector,
      groups: config.groups,
      droneIds: config.droneIds,
      targetClass: config.target || null,
      targetId: null,
      targetPosition: null,
      targetVelocity: null,
      detectedObjects: [],
      searchDispatched: false,
      searchWaypoints: null,
      params: {
        altitude: 10,
        radius: 15,
        distance: 10,
        spacing: 15,
        pattern: 'expanding_square',
        width: 80,
        height: 80,
        aggressive: false,
        ...config.params,
      },
      vars: config.vars || {},
    };

    // Build the tree from JSON definition
    const rootNode = buildNode(treeDef);
    this.tree = new BehaviorTree({
      tree: rootNode,
      blackboard: this.blackboard,
    });
  }

  start(tickMs = 500) {
    this._stopped = false;
    this._tickInterval = setInterval(() => this._tick(), tickMs);
    // Immediate first tick
    this._tick();
    return this.status();
  }

  stop() {
    this._stopped = true;
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
    // Hover all drones
    for (const id of this.blackboard.droneIds) {
      this.blackboard.backend.hover(id).catch(() => {});
    }
  }

  _tick() {
    if (this._stopped) return;

    // Sync group membership if tracked
    this._syncGroup();

    try {
      this.tree.step();
    } catch (err) {
      console.error(`[Plan ${this.id}] Tick error:`, err.message);
    }
  }

  _syncGroup() {
    const bb = this.blackboard;
    if (!bb._groupName || !bb.groups) return;
    
    const currentIds = bb.groups.getDronesInGroup(bb._groupName);
    if (!currentIds || currentIds.length === 0) return;

    const changed = currentIds.length !== bb.droneIds.length ||
      currentIds.some(id => !bb.droneIds.includes(id));
    
    if (changed) {
      bb.droneIds = currentIds;
    }
  }

  status() {
    const elapsed = Math.round((Date.now() - this.startedAt) / 1000);
    return {
      plan_id: this.id,
      name: this.name,
      running: !this._stopped,
      target: this.blackboard.targetClass,
      target_found: !!this.blackboard.targetPosition,
      target_position: this.blackboard.targetPosition,
      drones: this.blackboard.droneIds.length,
      drone_ids: this.blackboard.droneIds,
      elapsed_s: elapsed,
      vars: { ...this.blackboard.vars },
    };
  }
}

// ─── Plan Manager ───────────────────────────────────────────────────

class PlanManager {
  constructor() {
    /** @type {Map<string, Plan>} */
    this.plans = new Map();
    /** @type {Map<string, string>} group/droneSet key → plan_id */
    this.groupPlans = new Map();
  }

  _droneKey(droneIds) {
    return [...droneIds].sort().join(',');
  }

  /**
   * Start a plan from a template name or custom tree JSON.
   */
  start(config) {
    const { plan, tree, target, droneIds, backend, detector, groups, groupName, params, vars } = config;

    // Resolve tree definition
    let treeDef;
    if (tree) {
      treeDef = tree; // Custom JSON tree from LLM
    } else if (plan && TEMPLATES[plan]) {
      treeDef = TEMPLATES[plan];
    } else {
      const available = Object.keys(TEMPLATES).join(', ');
      throw new Error(`Unknown plan template: "${plan}". Available: ${available}`);
    }

    // Stop existing plan for this group/drone-set
    const key = groupName || this._droneKey(droneIds);
    const existingId = this.groupPlans.get(key);
    if (existingId) {
      const existing = this.plans.get(existingId);
      if (existing) existing.stop();
      this.groupPlans.delete(key);
    }

    const instance = new Plan(treeDef, {
      name: plan || treeDef.name || 'custom',
      target,
      droneIds,
      backend,
      detector,
      groups,
      params,
      vars,
    });

    // Track group association
    if (groupName) {
      instance.blackboard._groupName = groupName;
    }

    this.plans.set(instance.id, instance);
    this.groupPlans.set(key, instance.id);

    return instance.start();
  }

  /**
   * Stop a plan by ID, or all plans.
   */
  stop(planId) {
    if (planId) {
      const plan = this.plans.get(planId);
      if (!plan) return { error: `Plan ${planId} not found` };
      plan.stop();
      for (const [key, id] of this.groupPlans) {
        if (id === planId) { this.groupPlans.delete(key); break; }
      }
      return plan.status();
    }

    // Stop all
    let stopped = 0;
    for (const [, plan] of this.plans) {
      if (!plan._stopped) { plan.stop(); stopped++; }
    }
    this.groupPlans.clear();
    return { stopped };
  }

  /**
   * Get status of one or all plans.
   */
  status(planId) {
    if (planId) {
      const plan = this.plans.get(planId);
      return plan ? plan.status() : { error: `Plan ${planId} not found` };
    }

    const active = [];
    for (const [, id] of this.groupPlans) {
      const p = this.plans.get(id);
      if (p && !p._stopped) active.push(p.status());
    }

    if (active.length === 0) return { active_plans: 0, status: 'idle' };
    if (active.length === 1) return active[0];
    return { active_plans: active.length, plans: active };
  }

  /**
   * List available templates + registered actions/conditions.
   */
  capabilities() {
    return {
      templates: Object.keys(TEMPLATES),
      actions: Object.keys(ACTION_REGISTRY),
      conditions: Object.keys(CONDITION_REGISTRY),
      node_types: ['sequence', 'selector', 'parallel', 'random', 'repeat', 'invert', 'alwaysSucceed', 'alwaysFail', 'cooldown'],
    };
  }
}

export const planManager = new PlanManager();
