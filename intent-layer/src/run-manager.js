import { validateIntentDocument } from './intent-schema.js';
import { resolveIntentDocument } from './resolver.js';
import { compileToRunPackage } from './compiler.js';

export class SingleRobotRunManager {
  constructor(adapter) {
    this.adapter = adapter;
    this.runs = new Map();
  }

  async createRun(intent, worldContext = {}, options = {}) {
    const validation = validateIntentDocument(intent);
    if (!validation.ok) {
      throw new Error(`Intent validation failed: ${validation.errors.join('; ')}`);
    }

    const resolvedIntent = resolveIntentDocument(intent, worldContext);
    const runPackage = compileToRunPackage(resolvedIntent, options);

    this.runs.set(runPackage.runId, {
      runId: runPackage.runId,
      actorId: resolvedIntent.actor.id,
      status: 'created',
      package: runPackage,
      intent: resolvedIntent,
    });

    return runPackage;
  }

  async startRun(runPackage) {
    const status = await this.adapter.start(runPackage);
    this.runs.set(runPackage.runId, { ...this.runs.get(runPackage.runId), status: status.status });
    return status;
  }

  async getRunStatus(runId) {
    return this.adapter.status(runId);
  }

  async stopRun(runId) {
    return this.adapter.stop(runId);
  }
}
