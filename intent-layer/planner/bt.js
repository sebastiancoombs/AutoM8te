/**
 * AutoM8te Behavior Tree Engine
 * 
 * Purpose-built for async drone operations. Modeled on BehaviorTree.CPP:
 *   - StatefulAction nodes (onStart / onRunning / onHalted)
 *   - ReactiveSequence (re-checks conditions every tick, halts on failure)
 *   - Halt propagation through the tree
 *   - Shared blackboard with event bus
 *   - Timeout and retry decorators built-in
 * 
 * Every node returns: SUCCESS | FAILURE | RUNNING
 * Nodes in RUNNING state get ticked again. Nodes get halted when preempted.
 */

// ─── Status Constants ───────────────────────────────────────────────

export const SUCCESS = 'SUCCESS';
export const FAILURE = 'FAILURE';
export const RUNNING = 'RUNNING';
export const IDLE    = 'IDLE';

// ─── Event Bus ──────────────────────────────────────────────────────

export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  emit(event, data) {
    const arr = this._listeners.get(event);
    if (arr) arr.forEach(fn => fn(data));
  }

  once(event, fn) {
    const unsub = this.on(event, (data) => {
      unsub();
      fn(data);
    });
    return unsub;
  }
}

// ─── Blackboard ─────────────────────────────────────────────────────

/**
 * Shared state for the tree. Nodes read/write through typed accessors.
 * Supports parent blackboards for scoping (group → global).
 */
export class Blackboard {
  constructor(parent = null) {
    this._data = new Map();
    this._parent = parent;
    this.events = parent?.events || new EventBus();
  }

  get(key) {
    if (this._data.has(key)) return this._data.get(key);
    if (this._parent) return this._parent.get(key);
    return undefined;
  }

  set(key, value) {
    const old = this.get(key);
    this._data.set(key, value);
    if (old !== value) this.events.emit(`bb:${key}`, { key, value, old });
  }

  has(key) {
    return this._data.has(key) || (this._parent?.has(key) ?? false);
  }

  /** Bulk set from object */
  merge(obj) {
    for (const [k, v] of Object.entries(obj)) {
      this.set(k, v);
    }
  }

  /** Create a child scope */
  child() {
    return new Blackboard(this);
  }
}

// ─── Base Node ──────────────────────────────────────────────────────

let nodeIdCounter = 0;

export class TreeNode {
  constructor(name = '') {
    this.id = ++nodeIdCounter;
    this.name = name;
    this.status = IDLE;
    this._blackboard = null;
  }

  setBlackboard(bb) {
    this._blackboard = bb;
  }

  get bb() {
    return this._blackboard;
  }

  /**
   * Execute this node. Called by parent.
   * Manages status transitions and calls the subclass tick().
   */
  async executeTick() {
    const result = await this.tick();
    this.status = result;
    return result;
  }

  /** Override in subclass */
  async tick() {
    return FAILURE;
  }

  /**
   * Called when this node is interrupted (parent cancels it).
   * Override to clean up async operations.
   */
  async halt() {
    this.status = IDLE;
  }

  /** Reset to idle */
  reset() {
    this.status = IDLE;
  }
}

// ─── Action Nodes (Leaves) ──────────────────────────────────────────

/**
 * SyncAction — returns SUCCESS or FAILURE immediately.
 * For conditions and instant actions.
 */
export class SyncAction extends TreeNode {
  constructor(name, fn) {
    super(name);
    this._fn = fn;
  }

  async tick() {
    return await this._fn(this.bb);
  }
}

/**
 * StatefulAction — the core async action pattern.
 * Three callbacks: onStart, onRunning, onHalted.
 * 
 * - onStart(): called when transitioning from IDLE → first tick.
 *   Return SUCCESS, FAILURE, or RUNNING.
 * - onRunning(): called on subsequent ticks while RUNNING.
 *   Return SUCCESS, FAILURE, or RUNNING.
 * - onHalted(): called when interrupted. Clean up here.
 */
export class StatefulAction extends TreeNode {
  constructor(name, { onStart, onRunning, onHalted } = {}) {
    super(name);
    this._onStart = onStart || (() => SUCCESS);
    this._onRunning = onRunning || (() => SUCCESS);
    this._onHalted = onHalted || (() => {});
  }

  async tick() {
    if (this.status === IDLE || this.status === SUCCESS || this.status === FAILURE) {
      // Fresh start
      const result = await this._onStart(this.bb);
      this.status = result;
      return result;
    }
    // Already RUNNING — continue
    const result = await this._onRunning(this.bb);
    this.status = result;
    return result;
  }

  async halt() {
    if (this.status === RUNNING) {
      await this._onHalted(this.bb);
    }
    this.status = IDLE;
  }
}

// ─── Control Nodes ──────────────────────────────────────────────────

/**
 * Sequence — ticks children left-to-right.
 * Returns SUCCESS if all succeed. FAILURE on first failure.
 * RUNNING if a child returns RUNNING (resumes from that child next tick).
 */
export class Sequence extends TreeNode {
  constructor(name, children = []) {
    super(name);
    this.children = children;
    this._current = 0;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    for (const c of this.children) c.setBlackboard(bb);
  }

  async tick() {
    while (this._current < this.children.length) {
      const child = this.children[this._current];
      const result = await child.executeTick();

      if (result === FAILURE) {
        await this._haltFrom(this._current + 1);
        this._current = 0;
        return FAILURE;
      }
      if (result === RUNNING) {
        return RUNNING;
      }
      // SUCCESS — move to next
      this._current++;
    }
    // All succeeded
    this._current = 0;
    return SUCCESS;
  }

  async halt() {
    await this._haltFrom(0);
    this._current = 0;
    this.status = IDLE;
  }

  async _haltFrom(idx) {
    for (let i = idx; i < this.children.length; i++) {
      if (this.children[i].status === RUNNING) {
        await this.children[i].halt();
      }
    }
  }
}

/**
 * ReactiveSequence — like Sequence, but re-evaluates ALL children
 * from the start every tick. If a condition earlier in the sequence
 * fails, running children get halted.
 * 
 * Rule: only ONE child can be RUNNING at a time.
 * Conditions (sync) before the running action get re-checked every tick.
 */
export class ReactiveSequence extends TreeNode {
  constructor(name, children = []) {
    super(name);
    this.children = children;
    this._runningChild = -1;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    for (const c of this.children) c.setBlackboard(bb);
  }

  async tick() {
    let haltSent = false;

    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      const result = await child.executeTick();

      if (result === FAILURE) {
        // Halt any running child
        if (this._runningChild >= 0 && this._runningChild !== i) {
          await this.children[this._runningChild].halt();
        }
        this._runningChild = -1;
        return FAILURE;
      }

      if (result === RUNNING) {
        // If a different child was running before, halt it
        if (this._runningChild >= 0 && this._runningChild !== i && !haltSent) {
          await this.children[this._runningChild].halt();
          haltSent = true;
        }
        this._runningChild = i;
        return RUNNING;
      }
      // SUCCESS — continue to next child
    }

    this._runningChild = -1;
    return SUCCESS;
  }

  async halt() {
    if (this._runningChild >= 0) {
      await this.children[this._runningChild].halt();
    }
    this._runningChild = -1;
    this.status = IDLE;
  }
}

/**
 * Selector (Fallback) — tries children left-to-right.
 * Returns SUCCESS on first success. FAILURE if all fail.
 */
export class Selector extends TreeNode {
  constructor(name, children = []) {
    super(name);
    this.children = children;
    this._current = 0;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    for (const c of this.children) c.setBlackboard(bb);
  }

  async tick() {
    while (this._current < this.children.length) {
      const child = this.children[this._current];
      const result = await child.executeTick();

      if (result === SUCCESS) {
        await this._haltFrom(this._current + 1);
        this._current = 0;
        return SUCCESS;
      }
      if (result === RUNNING) {
        return RUNNING;
      }
      // FAILURE — try next
      this._current++;
    }
    this._current = 0;
    return FAILURE;
  }

  async halt() {
    await this._haltFrom(0);
    this._current = 0;
    this.status = IDLE;
  }

  async _haltFrom(idx) {
    for (let i = idx; i < this.children.length; i++) {
      if (this.children[i].status === RUNNING) {
        await this.children[i].halt();
      }
    }
  }
}

/**
 * ReactiveSelector — re-evaluates from start every tick.
 * Allows higher-priority branches to preempt lower ones.
 */
export class ReactiveSelector extends TreeNode {
  constructor(name, children = []) {
    super(name);
    this.children = children;
    this._runningChild = -1;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    for (const c of this.children) c.setBlackboard(bb);
  }

  async tick() {
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      const result = await child.executeTick();

      if (result === SUCCESS) {
        if (this._runningChild >= 0 && this._runningChild !== i) {
          await this.children[this._runningChild].halt();
        }
        this._runningChild = -1;
        return SUCCESS;
      }

      if (result === RUNNING) {
        if (this._runningChild >= 0 && this._runningChild !== i) {
          await this.children[this._runningChild].halt();
        }
        this._runningChild = i;
        return RUNNING;
      }
      // FAILURE — try next
    }
    this._runningChild = -1;
    return FAILURE;
  }

  async halt() {
    if (this._runningChild >= 0) {
      await this.children[this._runningChild].halt();
    }
    this._runningChild = -1;
    this.status = IDLE;
  }
}

/**
 * Parallel — ticks all children every tick.
 * Policy controls when it returns:
 *   - successThreshold: how many must succeed for SUCCESS (default: all)
 *   - failureThreshold: how many must fail for FAILURE (default: 1)
 */
export class Parallel extends TreeNode {
  constructor(name, children = [], { successThreshold, failureThreshold } = {}) {
    super(name);
    this.children = children;
    this._successThreshold = successThreshold ?? children.length;
    this._failureThreshold = failureThreshold ?? 1;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    for (const c of this.children) c.setBlackboard(bb);
  }

  async tick() {
    let successCount = 0;
    let failureCount = 0;

    // Tick all children
    const results = await Promise.all(
      this.children.map(c => c.executeTick())
    );

    for (const r of results) {
      if (r === SUCCESS) successCount++;
      else if (r === FAILURE) failureCount++;
    }

    if (failureCount >= this._failureThreshold) {
      await this._haltRunning();
      return FAILURE;
    }
    if (successCount >= this._successThreshold) {
      await this._haltRunning();
      return SUCCESS;
    }
    return RUNNING;
  }

  async halt() {
    await this._haltRunning();
    this.status = IDLE;
  }

  async _haltRunning() {
    for (const c of this.children) {
      if (c.status === RUNNING) await c.halt();
    }
  }
}

// ─── Decorator Nodes ────────────────────────────────────────────────

/**
 * Base decorator — wraps a single child.
 */
class Decorator extends TreeNode {
  constructor(name, child) {
    super(name);
    this.child = child;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    this.child.setBlackboard(bb);
  }

  async halt() {
    if (this.child.status === RUNNING) await this.child.halt();
    this.status = IDLE;
  }
}

/**
 * Inverter — flips SUCCESS ↔ FAILURE, RUNNING passes through.
 */
export class Inverter extends Decorator {
  async tick() {
    const result = await this.child.executeTick();
    if (result === SUCCESS) return FAILURE;
    if (result === FAILURE) return SUCCESS;
    return RUNNING;
  }
}

/**
 * ForceSuccess — always returns SUCCESS (unless RUNNING).
 */
export class ForceSuccess extends Decorator {
  async tick() {
    const result = await this.child.executeTick();
    return result === RUNNING ? RUNNING : SUCCESS;
  }
}

/**
 * ForceFailure — always returns FAILURE (unless RUNNING).
 */
export class ForceFailure extends Decorator {
  async tick() {
    const result = await this.child.executeTick();
    return result === RUNNING ? RUNNING : FAILURE;
  }
}

/**
 * Repeat — re-runs child up to N times (or forever if N = Infinity).
 * Resets child to IDLE after each completion.
 */
export class Repeat extends Decorator {
  constructor(name, child, times = Infinity) {
    super(name, child);
    this._times = times;
    this._count = 0;
  }

  async tick() {
    while (this._count < this._times) {
      const result = await this.child.executeTick();

      if (result === RUNNING) return RUNNING;

      if (result === FAILURE) {
        this._count = 0;
        this.child.reset();
        return FAILURE;
      }

      // SUCCESS — reset child and loop
      this._count++;
      this.child.reset();
    }

    this._count = 0;
    return SUCCESS;
  }

  async halt() {
    this._count = 0;
    await super.halt();
  }
}

/**
 * RetryUntilSuccess — retries child on failure, up to N times.
 */
export class RetryUntilSuccess extends Decorator {
  constructor(name, child, maxRetries = 3) {
    super(name, child);
    this._max = maxRetries;
    this._retries = 0;
  }

  async tick() {
    while (this._retries < this._max) {
      const result = await this.child.executeTick();

      if (result === SUCCESS) {
        this._retries = 0;
        return SUCCESS;
      }
      if (result === RUNNING) return RUNNING;

      // FAILURE — retry
      this._retries++;
      this.child.reset();
    }

    this._retries = 0;
    return FAILURE;
  }

  async halt() {
    this._retries = 0;
    await super.halt();
  }
}

/**
 * Timeout — fails if child stays RUNNING longer than duration.
 */
export class Timeout extends Decorator {
  constructor(name, child, ms) {
    super(name, child);
    this._ms = ms;
    this._startedAt = null;
  }

  async tick() {
    if (this._startedAt === null) {
      this._startedAt = Date.now();
    }

    const elapsed = Date.now() - this._startedAt;
    if (elapsed >= this._ms) {
      await this.child.halt();
      this._startedAt = null;
      return FAILURE;
    }

    const result = await this.child.executeTick();
    if (result !== RUNNING) {
      this._startedAt = null;
    }
    return result;
  }

  async halt() {
    this._startedAt = null;
    await super.halt();
  }
}

/**
 * Cooldown — after child completes, prevents re-execution for N ms.
 */
export class Cooldown extends Decorator {
  constructor(name, child, ms) {
    super(name, child);
    this._ms = ms;
    this._lastComplete = 0;
  }

  async tick() {
    if (this.child.status === RUNNING) {
      // Already running — let it finish
      const result = await this.child.executeTick();
      if (result !== RUNNING) this._lastComplete = Date.now();
      return result;
    }

    const elapsed = Date.now() - this._lastComplete;
    if (elapsed < this._ms) return FAILURE; // Still cooling down

    const result = await this.child.executeTick();
    if (result !== RUNNING) this._lastComplete = Date.now();
    return result;
  }
}

/**
 * Condition decorator — guards a child. Checks condition before
 * every tick. If condition fails, halts the child.
 */
export class Guard extends Decorator {
  constructor(name, condition, child) {
    super(name, child);
    this._condition = condition;
  }

  setBlackboard(bb) {
    super.setBlackboard(bb);
    this._condition.setBlackboard(bb);
  }

  async tick() {
    const condResult = await this._condition.executeTick();
    if (condResult === FAILURE) {
      if (this.child.status === RUNNING) await this.child.halt();
      return FAILURE;
    }
    return await this.child.executeTick();
  }

  async halt() {
    this._condition.reset();
    await super.halt();
  }
}

// ─── Tree Runner ────────────────────────────────────────────────────

export class BehaviorTreeRunner {
  constructor(root, blackboard) {
    this.root = root;
    this.blackboard = blackboard;
    this.root.setBlackboard(blackboard);
    this._interval = null;
    this._tickCount = 0;
  }

  /** Single tick of the tree */
  async tick() {
    this._tickCount++;
    return await this.root.executeTick();
  }

  /** Start ticking on an interval */
  start(intervalMs = 500) {
    if (this._interval) return;
    this._interval = setInterval(() => {
      this.tick().catch(err => {
        console.error(`[BT tick ${this._tickCount}] Error:`, err.message);
      });
    }, intervalMs);
    // Immediate first tick
    this.tick().catch(() => {});
  }

  /** Stop ticking and halt the tree */
  async stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    await this.root.halt();
  }

  get ticks() {
    return this._tickCount;
  }
}
