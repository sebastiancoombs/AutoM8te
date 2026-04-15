import { StateFabricBase } from './state-fabric-base.js';

export class ZenohStateFabric extends StateFabricBase {
  constructor() {
    super('zenoh');
    this.store = {
      backends: {},
      actors: {},
      goals: {},
      observations: {},
      runs: {},
    };
  }

  async publishState(backend, projection) {
    this.store.backends[backend] = projection;
    Object.assign(this.store.actors, projection.actors || {});
    Object.assign(this.store.goals, projection.goals || {});
    Object.assign(this.store.runs, projection.runs || {});
    for (const [actorId, obs] of Object.entries(projection.observations || {})) {
      this.store.observations[actorId] = obs;
    }
    return { ok: true, backend, actors: Object.keys(projection.actors || {}).length };
  }

  async queryState(selector = {}) {
    if (selector.backend) {
      return this.store.backends[selector.backend] || null;
    }
    return structuredClone(this.store);
  }

  async getActorState(actorId) {
    return this.store.actors[actorId] || null;
  }
}
