export class UnrealStateClient {
  constructor({ transport = null, normalizer = null } = {}) {
    this.transport = transport;
    this.normalizer = normalizer;
  }

  async fetchState(query = {}) {
    if (!this.transport || typeof this.transport.fetchState !== 'function') {
      return {
        status: 'state-fetch-unavailable',
        query,
        payload: null,
      };
    }

    const payload = await this.transport.fetchState(query);
    if (this.normalizer) {
      return this.normalizer(payload, query);
    }

    return payload;
  }

  async pushState(payload) {
    if (!this.transport || typeof this.transport.pushState !== 'function') {
      return {
        status: 'state-push-unavailable',
        payload,
      };
    }
    return this.transport.pushState(payload);
  }

  async getNormalizedWorldState(query = {}) {
    const result = await this.fetchState(query);
    return {
      backend: 'unreal',
      query,
      state: result?.payload || null,
      transportStatus: result?.status || 'unknown',
    };
  }

  buildFeedbackEvents(worldState = {}, query = {}) {
    const actors = worldState?.state?.actors || [];
    return actors.map(actor => ({
      backend: 'unreal',
      actorIds: [actor.id],
      kind: 'state',
      data: actor,
      query,
    }));
  }
}
