import { ConsumerBase } from './consumer-base.js';

export class UnrealConsumer extends ConsumerBase {
  constructor() {
    super('unreal');
  }

  consume(payload = {}) {
    const actors = {};
    const goals = {};
    const observations = {};
    const runs = {};

    for (const actor of payload.actors || []) {
      const normalized = this.normalizeActor({
        ...actor,
        currentGoal: actor.currentGoal || actor.blackboard?.goal || actor.goal,
        currentBehavior: actor.currentBehavior || actor.blackboard?.behavior || actor.behavior_tree,
      });

      normalized.controller = actor.controller || actor.aiController || 'AIController';
      normalized.behaviorTree = actor.behavior_tree || actor.behaviorTree || null;
      normalized.blackboard = actor.blackboard ? structuredClone(actor.blackboard) : {};
      normalized.camera = actor.camera
        ? {
            mounted: true,
            ...structuredClone(actor.camera),
          }
        : { mounted: false };
      normalized.perception = actor.perception ? structuredClone(actor.perception) : {};

      actors[normalized.id] = normalized;
    }

    for (const [goalId, goal] of Object.entries(payload.goals || {})) {
      goals[goalId] = this.normalizeGoal(goalId, goal);
    }

    for (const [actorId, items] of Object.entries(payload.observations || {})) {
      observations[actorId] = (items || []).map(item => this.normalizeObservation(item));
    }

    for (const [runId, run] of Object.entries(payload.runs || {})) {
      runs[runId] = this.normalizeRun(runId, run);
    }

    return {
      backend: this.backend,
      actors,
      goals,
      observations,
      runs,
      raw: structuredClone(payload),
    };
  }
}
