import { UnrealConsumer } from './consumer-unreal.js';
import { Nav2Consumer } from './consumer-nav2.js';

export function translateUnrealState(payload = {}) {
  return new UnrealConsumer().consume(payload);
}

export function translateRealState(payload = {}) {
  return new Nav2Consumer().consume({ ...(payload || {}), backend: payload.backend || 'real' });
}

export function projectWorldState({ backend, payload }) {
  if (backend === 'unreal') return translateUnrealState(payload);
  return translateRealState({ ...(payload || {}), backend });
}
