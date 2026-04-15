import { ConsumerBase } from './consumer-base.js';

export class Nav2Consumer extends ConsumerBase {
  constructor() {
    super('nav2');
  }

  consume(payload = {}) {
    const actors = {};
    const goals = {};
    const observations = {};
    const runs = {};

    for (const actor of payload.actors || []) {
      const normalized = this.normalizeActor({
        ...actor,
        currentGoal: actor.currentGoal || actor.goal || actor.navigation_goal,
        currentBehavior: actor.currentBehavior || actor.bt_tree || actor.navigator_state,
      });

      normalized.navigator = actor.navigator || actor.navigator_state || 'unknown';
      normalized.localization = actor.localization ? structuredClone(actor.localization) : {};
      normalized.costmaps = actor.costmaps ? structuredClone(actor.costmaps) : {};
      normalized.tf = actor.tf ? structuredClone(actor.tf) : undefined;

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
