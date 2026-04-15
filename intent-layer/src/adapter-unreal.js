function mapNode(node) {
  if (node.type) {
    switch (node.type) {
      case 'sequence':
        return {
          kind: 'Sequence',
          children: node.children.map(mapNode),
        };
      case 'fallback':
        return {
          kind: 'Selector',
          children: node.children.map(mapNode),
        };
      case 'retry':
        return {
          kind: 'Retry',
          times: node.times,
          child: mapNode(node.child),
        };
      case 'repeat':
        return {
          kind: 'Loop',
          child: mapNode(node.child),
        };
      case 'guard':
        return {
          kind: 'Guard',
          condition: mapNode(node.condition),
          child: mapNode(node.child),
        };
      case 'timeout':
        return {
          kind: 'Timeout',
          duration_s: node.duration_s,
          child: mapNode(node.child),
        };
      default:
        throw new Error(`Unsupported structural type for Unreal adapter: ${node.type}`);
    }
  }

  if (node.op) {
    switch (node.op) {
      case 'navigate_to':
        return { kind: 'Task', task: 'MoveTo', params: { goal: node.goal } };
      case 'compute_path':
        return { kind: 'Task', task: 'RunEQSOrPathQuery', params: { goal: node.goal } };
      case 'follow_path':
        return { kind: 'Task', task: 'FollowResolvedPath', params: {} };
      case 'wait':
        return { kind: 'Task', task: 'Wait', params: { duration_s: node.duration_s } };
      case 'backup':
        return { kind: 'Task', task: 'MoveBackward', params: { distance_m: node.distance_m } };
      case 'spin':
        return { kind: 'Task', task: 'RotateInPlace', params: { angle_rad: node.angle_rad } };
      case 'hold_position':
        return { kind: 'Task', task: 'HoldPosition', params: {} };
      case 'goal_updated':
        return { kind: 'Decorator', task: 'GoalUpdated', params: {} };
      case 'goal_reached':
        return { kind: 'Decorator', task: 'GoalReached', params: {} };
      case 'is_battery_low':
        return { kind: 'Decorator', task: 'IsBatteryLow', params: { threshold: node.threshold } };
      case 'clear_costmap':
        return { kind: 'Task', task: 'RefreshNavigation', params: { scope: node.scope } };
      default:
        throw new Error(`Unsupported op for Unreal adapter: ${node.op}`);
    }
  }

  throw new Error('Invalid node');
}

export class UnrealBackendAdapter {
  constructor() {
    this.runs = new Map();
  }

  async validateSupport(input) {
    try {
      this.#buildUnrealPackage(input);
      return { ok: true };
    } catch (error) {
      return { ok: false, errors: [error.message] };
    }
  }

  async compile(input) {
    const backendPackage = this.#buildUnrealPackage(input);
    return {
      backend: 'unreal',
      runId: input.runId,
      actorIds: input.actorIds,
      backendPackage,
      metadata: input.metadata || {},
    };
  }

  async start(runPackage) {
    const compiled = runPackage.backendPackage ? runPackage : await this.compile(runPackage);
    const status = {
      runId: compiled.runId,
      backend: 'unreal',
      actorIds: compiled.actorIds,
      status: 'running',
      currentBehavior: compiled.backendPackage.behaviorTree.root.kind,
      metadata: {
        launched: true,
        controller: 'AIController',
        blackboard: compiled.backendPackage.blackboard,
      },
      rawBackendState: compiled.backendPackage,
    };
    this.runs.set(compiled.runId, status);
    return status;
  }

  async status(runId) {
    return this.runs.get(runId) || {
      runId,
      backend: 'unreal',
      actorIds: [],
      status: 'failed',
      errors: ['run not found'],
    };
  }

  async stop(runId) {
    const current = await this.status(runId);
    const stopped = { ...current, status: 'stopped' };
    this.runs.set(runId, stopped);
    return stopped;
  }

  #buildUnrealPackage(input) {
    const intent = input.intent || input.package?.intent || input;
    const actorIds = input.actorIds || [intent.actor?.id].filter(Boolean);
    if (actorIds.length !== 1) {
      throw new Error('Unreal backend v1 supports exactly one actor');
    }

    const blackboardValues = {
      actor_id: actorIds[0],
      mode: intent.mode,
      goal_id: extractPrimaryGoalId(intent.root),
      goal_location: null,
      current_behavior: null,
      interrupt_requested: false,
      target_visible: false,
      health_state: 'ok',
      ...(input.resolvedContext || {}),
    };

    return {
      backend: 'unreal',
      actorId: actorIds[0],
      aiController: 'AutoMateAIController',
      blackboard: {
        keys: [
          { name: 'actor_id', type: 'String', defaultValue: actorIds[0] },
          { name: 'mode', type: 'String', defaultValue: intent.mode },
          { name: 'goal_id', type: 'String', defaultValue: blackboardValues.goal_id || '' },
          { name: 'goal_location', type: 'Vector', defaultValue: null },
          { name: 'current_behavior', type: 'String', defaultValue: '' },
          { name: 'interrupt_requested', type: 'Bool', defaultValue: false },
          { name: 'target_visible', type: 'Bool', defaultValue: false },
          { name: 'health_state', type: 'String', defaultValue: 'ok' },
        ],
        values: blackboardValues,
      },
      behaviorTree: {
        root: mapNode(intent.root),
      },
      bindings: {
        controller: 'AutoMateAIController',
      },
    };
  }
}

function extractPrimaryGoalId(node) {
  if (!node) return null;
  if (node.goal) return node.goal;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const goal = extractPrimaryGoalId(child);
      if (goal) return goal;
    }
  }
  if (node.child) return extractPrimaryGoalId(node.child);
  if (node.condition) return extractPrimaryGoalId(node.condition);
  return null;
}
