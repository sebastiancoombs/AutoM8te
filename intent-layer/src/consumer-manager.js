export class ConsumerManager {
  constructor() {
    this.backends = new Map();
    this.actorBackendIndex = new Map();
  }

  registerBackend(backend, consumer) {
    this.backends.set(backend, consumer);
    return this;
  }

  consumeBackendState(backend, payload = {}) {
    const consumer = this.backends.get(backend);
    if (!consumer) {
      throw new Error(`No consumer registered for backend: ${backend}`);
    }

    const world = consumer.consume(payload);
    for (const actorId of Object.keys(world.actors || {})) {
      this.actorBackendIndex.set(actorId, backend);
    }
    return world;
  }

  consumeMany(inputs = []) {
    const merged = {
      backends: {},
      actors: {},
      goals: {},
      observations: {},
      runs: {},
    };

    for (const input of inputs) {
      const world = this.consumeBackendState(input.backend, input.payload);
      merged.backends[input.backend] = world;
      Object.assign(merged.actors, world.actors || {});
      Object.assign(merged.goals, world.goals || {});
      Object.assign(merged.runs, world.runs || {});
      for (const [actorId, obs] of Object.entries(world.observations || {})) {
        merged.observations[actorId] = obs;
      }
    }

    return merged;
  }

  getBackendForActor(actorId) {
    return this.actorBackendIndex.get(actorId);
  }

  getConsumerForActor(actorId) {
    const backend = this.getBackendForActor(actorId);
    return backend ? this.backends.get(backend) : null;
  }
}
