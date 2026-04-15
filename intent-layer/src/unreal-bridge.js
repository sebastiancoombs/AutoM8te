import { UnrealBackendAdapter } from './adapter-unreal.js';
import { UnrealConsumer } from './consumer-unreal.js';
import { UnrealDispatcher } from './unreal-dispatcher.js';
import { UnrealStateClient } from './unreal-state-client.js';

export class UnrealBridge {
  constructor({ stateFabric = null, transport = null, embodimentRegistry = {} } = {}) {
    this.adapter = new UnrealBackendAdapter();
    this.consumer = new UnrealConsumer();
    this.stateFabric = stateFabric;
    this.actorRegistry = new Map();
    this.dispatcher = new UnrealDispatcher({ transport, embodimentRegistry });
    this.stateClient = new UnrealStateClient({ transport });
    this.commands = [];
  }

  registerActor(actor) {
    this.actorRegistry.set(actor.id, {
      id: actor.id,
      actorClass: actor.actorClass || 'BP_FloatingPawn',
      controller: actor.controller || 'AutoMateAIController',
      camera: actor.camera || { mounted: true },
      capabilities: actor.capabilities || { move: true, camera: true, perception: true },
    });
    return this.actorRegistry.get(actor.id);
  }

  listActors() {
    return [...this.actorRegistry.values()];
  }

  async ingestState(payload) {
    const projection = this.consumer.consume(payload);
    if (this.stateFabric) {
      await this.stateFabric.publishState('unreal', projection);
    }
    return projection;
  }

  async compileRun(input) {
    const support = await this.adapter.validateSupport(input);
    if (!support.ok) {
      throw new Error(`Unreal backend does not support input: ${support.errors.join('; ')}`);
    }
    return this.adapter.compile(input);
  }

  async startRun(input) {
    const compiled = await this.compileRun(input);
    const actor = compiled.actorIds?.length === 1 ? this.actorRegistry.get(compiled.actorIds[0]) || null : null;
    const dispatchResult = await this.dispatcher.dispatch({ compiledRun: compiled, actor });
    this.commands.push({ runId: compiled.runId, dispatch: dispatchResult.payload?.dispatch || null });
    const status = await this.adapter.start(compiled);
    return {
      ...status,
      dispatch: dispatchResult.payload?.dispatch || null,
      dispatchStatus: dispatchResult.status,
      feedbackLoop: {
        backend: 'unreal',
        runId: compiled.runId,
        actorIds: compiled.actorIds,
        mode: 'stream-or-poll',
      },
    };
  }

  getDispatch(runId) {
    return this.commands.find(c => c.runId === runId) || null;
  }

  async fetchAuthoritativeState(query = {}) {
    const payload = await this.stateClient.fetchState(query);
    if (payload?.payload && this.stateFabric) {
      const projection = this.consumer.consume(payload.payload);
      await this.stateFabric.publishState('unreal', projection);
      return projection;
    }
    return payload;
  }

  async getFeedbackLoopState(query = {}) {
    const worldState = await this.stateClient.getNormalizedWorldState(query);
    const feedbackEvents = this.stateClient.buildFeedbackEvents(worldState, query);
    return {
      worldState,
      feedbackEvents,
    };
  }
}
