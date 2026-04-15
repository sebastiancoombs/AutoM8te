import { UnrealEmbodimentAdapter } from './unreal-embodiment-adapter.js';
import { UnrealAircraftEmbodimentAdapter } from './unreal-embodiment-aircraft.js';
import { UnrealVehicleEmbodimentAdapter } from './unreal-embodiment-vehicle.js';
import { UnrealCharacterEmbodimentAdapter } from './unreal-embodiment-character.js';

export class UnrealDispatcher {
  constructor({ transport = null, embodimentRegistry = {} } = {}) {
    this.transport = transport;
    this.embodimentRegistry = {
      generic_unreal: new GenericUnrealEmbodimentAdapter(),
      aircraft: new UnrealAircraftEmbodimentAdapter(),
      vehicle: new UnrealVehicleEmbodimentAdapter(),
      character: new UnrealCharacterEmbodimentAdapter(),
      ...embodimentRegistry,
    };
  }

  registerEmbodiment(name, adapter) {
    this.embodimentRegistry[name] = adapter;
    return this;
  }

  getEmbodimentAdapter(name = 'generic_unreal') {
    return this.embodimentRegistry[name] || this.embodimentRegistry.generic_unreal;
  }

  buildDispatchPayload({ compiledRun, actor = null }) {
    const backendPackage = compiledRun.backendPackage || compiledRun;
    const embodimentProfile = actor?.embodimentProfile || backendPackage.embodimentProfile || 'generic_unreal';
    const adapter = this.getEmbodimentAdapter(embodimentProfile);
    const actionGraph = adapter.buildActionGraph({ backendPackage, actor });

    return {
      backend: 'unreal',
      runId: compiledRun.runId,
      actorIds: compiledRun.actorIds || [backendPackage.actorId].filter(Boolean),
      embodimentProfile,
      dispatch: actionGraph,
      metadata: {
        ...(compiledRun.metadata || {}),
        dispatchOnly: true,
      },
    };
  }

  async dispatch(input) {
    const payload = this.buildDispatchPayload(input);
    if (!this.transport || typeof this.transport.dispatch !== 'function') {
      return {
        status: 'dispatch-prepared',
        payload,
      };
    }
    return this.transport.dispatch(payload);
  }
}

export class GenericUnrealEmbodimentAdapter extends UnrealEmbodimentAdapter {
  constructor(options = {}) {
    super({
      profile: 'generic_unreal',
      actorClass: 'UnrealActor',
      controller: 'AIController',
      ...options,
    });
  }
}
