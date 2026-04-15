export class StateFabricBase {
  constructor(name) {
    this.name = name;
  }

  async publishState(_backend, _projection) {
    throw new Error(`${this.constructor.name} must implement publishState(backend, projection)`);
  }

  async queryState(_selector = {}) {
    throw new Error(`${this.constructor.name} must implement queryState(selector)`);
  }

  async getActorState(_actorId) {
    throw new Error(`${this.constructor.name} must implement getActorState(actorId)`);
  }
}
