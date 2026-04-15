export class ConsumerBase {
  constructor(backend) {
    this.backend = backend;
  }

  consume(_payload) {
    throw new Error(`${this.constructor.name} must implement consume(payload)`);
  }

  normalizeActor(source = {}) {
    return {
      id: source.id || source.actor_id || source.name,
      backend: this.backend,
      kind: source.kind || source.type || 'robot',
      pose: this.normalizePose(source),
      velocity: this.normalizeVelocity(source),
      status: source.status || source.mode || 'unknown',
      health: this.normalizeHealth(source),
      capabilities: this.normalizeCapabilities(source),
      currentGoal: source.currentGoal || source.current_goal,
      currentRunId: source.currentRunId || source.current_run_id,
      currentBehavior: source.currentBehavior || source.current_behavior,
      raw: structuredClone(source),
    };
  }

  normalizePose(source = {}) {
    if (source.pose) return structuredClone(source.pose);
    if (Array.isArray(source.position)) {
      return {
        x: source.position[0] ?? 0,
        y: source.position[1] ?? 0,
        z: source.position[2] ?? 0,
        yaw: source.heading ?? source.yaw ?? 0,
      };
    }
    return {
      x: source.x ?? 0,
      y: source.y ?? 0,
      z: source.z ?? 0,
      yaw: source.yaw ?? 0,
    };
  }

  normalizeVelocity(source = {}) {
    if (source.velocity && !Array.isArray(source.velocity)) {
      return structuredClone(source.velocity);
    }
    if (Array.isArray(source.velocity)) {
      return {
        x: source.velocity[0] ?? 0,
        y: source.velocity[1] ?? 0,
        z: source.velocity[2] ?? 0,
      };
    }
    return {
      x: source.vx ?? 0,
      y: source.vy ?? 0,
      z: source.vz ?? 0,
    };
  }

  normalizeHealth(source = {}) {
    if (typeof source.health === 'string') return source.health;
    if (typeof source.battery === 'number') {
      if (source.battery < 0.15) return 'critical';
      if (source.battery < 0.35) return 'low';
    }
    return 'ok';
  }

  normalizeCapabilities(source = {}) {
    const caps = source.capabilities || {};
    return {
      move: !!(caps.move ?? true),
      camera: !!(caps.camera ?? source.camera ?? false),
      perception: !!(caps.perception ?? source.perception ?? false),
      local_autonomy: !!(caps.local_autonomy ?? source.local_autonomy ?? false),
    };
  }

  normalizeObservation(observation = {}) {
    return {
      id: observation.id || observation.track_id || observation.label || 'observation',
      type: observation.type || observation.class || 'unknown',
      confidence: observation.confidence ?? 1,
      pose: observation.pose
        ? structuredClone(observation.pose)
        : observation.position
          ? this.normalizePose({ position: observation.position })
          : undefined,
      raw: structuredClone(observation),
    };
  }

  normalizeGoal(goalId, goal = {}) {
    return {
      id: goalId,
      backend: this.backend,
      pose: this.normalizePose(goal),
      raw: structuredClone(goal),
    };
  }

  normalizeRun(runId, run = {}) {
    return {
      runId,
      backend: this.backend,
      actorIds: run.actorIds || run.actor_ids || [],
      status: run.status || 'unknown',
      currentBehavior: run.currentBehavior || run.current_behavior,
      raw: structuredClone(run),
    };
  }
}
