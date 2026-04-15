export class Nav2BackendAdapter {
  constructor() {
    this.runs = new Map();
  }

  async validateSupport(input) {
    return { ok: true };
  }

  async compile(input) {
    return input;
  }

  async start(runPackage) {
    const status = {
      runId: runPackage.runId,
      backend: 'nav2',
      actorIds: runPackage.actorIds,
      status: 'running',
      currentBehavior: runPackage.rootTreeId,
      metadata: { launched: true },
    };
    this.runs.set(runPackage.runId, status);
    return status;
  }

  async status(runId) {
    return this.runs.get(runId) || {
      runId,
      backend: 'nav2',
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
}
