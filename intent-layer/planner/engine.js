/**
 * Behavior Planner Engine
 * 
 * Bridges intent layer → behavior tree → backend adapter.
 * 
 * Uses the custom async BT engine (bt.js) — not the npm behaviortree package.
 * 
 * Key design decisions:
 *   - Every node is a fresh instance (no shared state)
 *   - Blackboard is per-plan with optional parent scope (global events)
 *   - JSON tree definitions compiled to node instances
 *   - Plans tick asynchronously, nodes can return RUNNING across ticks
 *   - Halt propagation: stopping a plan halts all running children
 *   - Cross-plan events via shared EventBus on global blackboard
 */

import {
  Blackboard, BehaviorTreeRunner, EventBus,
  Sequence, ReactiveSequence, Selector, ReactiveSelector,
  Parallel, Inverter, ForceSuccess, ForceFailure,
  Repeat, RetryUntilSuccess, Timeout, Cooldown, Guard,
  SUCCESS, FAILURE, RUNNING,
} from './bt.js';
import { ACTION_FACTORIES } from './actions.js';
import { TEMPLATES } from './templates.js';

// ─── Global Event Bus ───────────────────────────────────────────────
// Shared across all plans for cross-plan coordination.

const globalEvents = new EventBus();

// ─── JSON → Node Compiler ───────────────────────────────────────────

/**
 * Compile a JSON tree definition into a live node tree.
 * 
 * Supported types:
 *   Control:    sequence, reactiveSequence, selector, reactiveSelector, parallel
 *   Decorators: inverter, forceSuccess, forceFailure, repeat, retry, timeout, cooldown, guard
 *   Leaves:     any key from ACTION_FACTORIES
 */
function compileNode(def) {
  if (typeof def === 'string') {
    // Leaf node by name
    const factory = ACTION_FACTORIES[def];
    if (!factory) throw new Error(`Unknown node: "${def}". Available: ${Object.keys(ACTION_FACTORIES).join(', ')}`);
    return factory();
  }

  const { type, name, nodes, node } = def;

  // --- Control nodes ---
  switch (type) {
    case 'sequence':
      return new Sequence(name || 'sequence', (nodes || []).map(compileNode));

    case 'reactiveSequence':
      return new ReactiveSequence(name || 'reactiveSequence', (nodes || []).map(compileNode));

    case 'selector':
      return new Selector(name || 'selector', (nodes || []).map(compileNode));

    case 'reactiveSelector':
      return new ReactiveSelector(name || 'reactiveSelector', (nodes || []).map(compileNode));

    case 'parallel':
      return new Parallel(
        name || 'parallel',
        (nodes || []).map(compileNode),
        {
          successThreshold: def.successThreshold,
          failureThreshold: def.failureThreshold,
        }
      );

    // --- Decorators ---
    case 'inverter':
    case 'invert':
      return new Inverter(name || 'inverter', compileChild(def));

    case 'forceSuccess':
      return new ForceSuccess(name || 'forceSuccess', compileChild(def));

    case 'forceFailure':
      return new ForceFailure(name || 'forceFailure', compileChild(def));

    case 'repeat':
      return new Repeat(name || 'repeat', compileChild(def), def.times || Infinity);

    case 'retry':
      return new RetryUntilSuccess(name || 'retry', compileChild(def), def.maxRetries || 3);

    case 'timeout':
      return new Timeout(name || 'timeout', compileChild(def), def.ms || 30000);

    case 'cooldown':
      return new Cooldown(name || 'cooldown', compileChild(def), def.ms || 5000);

    case 'guard':
      if (!def.condition) throw new Error('Guard needs a condition');
      return new Guard(name || 'guard', compileNode(def.condition), compileChild(def));

    // --- Leaf node (action/condition by name) ---
    default: {
      const factory = ACTION_FACTORIES[type];
      if (!factory) {
        throw new Error(
          `Unknown node type: "${type}". ` +
          `Control: sequence, reactiveSequence, selector, reactiveSelector, parallel. ` +
          `Decorators: inverter, forceSuccess, forceFailure, repeat, retry, timeout, cooldown, guard. ` +
          `Actions: ${Object.keys(ACTION_FACTORIES).join(', ')}`
        );
      }
      return factory();
    }
  }
}

function compileChild(def) {
  if (def.node) return compileNode(def.node);
  if (def.nodes && def.nodes.length > 0) return compileNode(def.nodes[0]);
  throw new Error(`Node "${def.type}" needs a child (node or nodes[0])`);
}

// ─── Plan Instance ──────────────────────────────────────────────────

let planCounter = 0;

class Plan {
  constructor(treeDef, config) {
    this.id = `p_${String(++planCounter).padStart(3, '0')}`;
    this.name = config.name || treeDef.name || 'unnamed';
    this.startedAt = Date.now();
    this._stopped = false;

    // Create blackboard with global parent for cross-plan events
    const globalBB = new Blackboard();
    globalBB.events = globalEvents;
    this.blackboard = new Blackboard(globalBB);

    // Populate blackboard
    this.blackboard.merge({
      backend: config.backend,
      detector: config.detector,
      groups: config.groups,
      droneIds: config.droneIds,
      targetClass: config.target || null,
      targetId: null,
      targetPosition: null,
      targetVelocity: null,
      _lastKnownPosition: null,
      detectedObjects: [],
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
    });

    // Track target position for recovery
    this.blackboard.events.on('bb:targetPosition', ({ value }) => {
      if (value) this.blackboard.set('_lastKnownPosition', [...value]);
    });

    // Track group name for dynamic membership
    this._groupName = config.groupName || null;

    // Compile the tree
    const root = compileNode(treeDef);
    this.runner = new BehaviorTreeRunner(root, this.blackboard);
  }

  start(tickMs = 500) {
    this._stopped = false;
    this.runner.start(tickMs);

    // Emit plan started event
    globalEvents.emit('plan:started', { planId: this.id, name: this.name });

    return this.status();
  }

  async stop() {
    this._stopped = true;
    await this.runner.stop();
    globalEvents.emit('plan:stopped', { planId: this.id, name: this.name });
  }

  /** Sync group membership — call before status checks */
  syncGroup() {
    if (!this._groupName) return;
    const groups = this.blackboard.get('groups');
    if (!groups) return;

    const currentIds = groups.getDronesInGroup(this._groupName);
    if (!currentIds || currentIds.length === 0) return;

    const existing = this.blackboard.get('droneIds') || [];
    const changed = currentIds.length !== existing.length ||
      currentIds.some(id => !existing.includes(id));

    if (changed) {
      this.blackboard.set('droneIds', currentIds);
    }
  }

  status() {
    this.syncGroup();
    const elapsed = Math.round((Date.now() - this.startedAt) / 1000);
    return {
      plan_id: this.id,
      name: this.name,
      running: !this._stopped,
      target: this.blackboard.get('targetClass'),
      target_found: !!this.blackboard.get('targetPosition'),
      target_position: this.blackboard.get('targetPosition'),
      drones: (this.blackboard.get('droneIds') || []).length,
      drone_ids: this.blackboard.get('droneIds') || [],
      elapsed_s: elapsed,
      ticks: this.runner.ticks,
      vars: { ...(this.blackboard.get('vars') || {}) },
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
   * Start a plan from template or custom tree JSON.
   */
  async start(config) {
    const { plan, tree, target, droneIds, backend, detector, groups, groupName, params, vars } = config;

    let treeDef;
    if (tree) {
      treeDef = tree;
    } else if (plan && TEMPLATES[plan]) {
      treeDef = TEMPLATES[plan];
    } else {
      const available = Object.keys(TEMPLATES).join(', ');
      throw new Error(`Unknown plan template: "${plan}". Available: ${available}`);
    }

    // Stop existing plan for this drone set
    const key = groupName || this._droneKey(droneIds);
    const existingId = this.groupPlans.get(key);
    if (existingId) {
      const existing = this.plans.get(existingId);
      if (existing) await existing.stop();
      this.groupPlans.delete(key);
    }

    const instance = new Plan(treeDef, {
      name: plan || treeDef.name || 'custom',
      target, droneIds, backend, detector, groups, groupName, params, vars,
    });

    this.plans.set(instance.id, instance);
    this.groupPlans.set(key, instance.id);

    return instance.start();
  }

  /**
   * Stop a plan by ID or all plans.
   */
  async stop(planId) {
    if (planId) {
      const plan = this.plans.get(planId);
      if (!plan) return { error: `Plan ${planId} not found` };
      await plan.stop();
      for (const [key, id] of this.groupPlans) {
        if (id === planId) { this.groupPlans.delete(key); break; }
      }
      return plan.status();
    }

    let stopped = 0;
    for (const [, plan] of this.plans) {
      if (!plan._stopped) { await plan.stop(); stopped++; }
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
   * List capabilities — templates, actions, conditions, node types.
   */
  capabilities() {
    return {
      templates: Object.keys(TEMPLATES),
      actions: Object.keys(ACTION_FACTORIES),
      node_types: [
        'sequence', 'reactiveSequence', 'selector', 'reactiveSelector', 'parallel',
        'inverter', 'forceSuccess', 'forceFailure', 'repeat', 'retry', 'timeout', 'cooldown', 'guard',
      ],
      description: 'Compose trees from these node types. Actions are leaves. Control/decorator nodes wrap children.',
    };
  }

  /** Get global event bus for cross-plan coordination */
  get events() {
    return globalEvents;
  }
}

export const planManager = new PlanManager();
