export class StatePublisher {
  constructor({ consumerManager, stateFabric }) {
    this.consumerManager = consumerManager;
    this.stateFabric = stateFabric;
  }

  async publishBackendState(backend, payload) {
    const projection = this.consumerManager.consumeBackendState(backend, payload);
    await this.stateFabric.publishState(backend, projection);
    return projection;
  }

  async publishMany(inputs = []) {
    const published = [];
    for (const input of inputs) {
      published.push(await this.publishBackendState(input.backend, input.payload));
    }
    return published;
  }
}
