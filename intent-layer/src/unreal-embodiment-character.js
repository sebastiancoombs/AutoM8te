import { UnrealEmbodimentAdapter } from './unreal-embodiment-adapter.js';

export class UnrealCharacterEmbodimentAdapter extends UnrealEmbodimentAdapter {
  constructor(options = {}) {
    super({
      profile: 'character',
      actorClass: 'BP_Character',
      controller: 'BP_CharacterController',
      ...options,
    });
  }

  mapAction(action) {
    const nameMap = {
      MoveTo: 'CharacterMoveToTarget',
      RunEQSOrPathQuery: 'CharacterBuildRoute',
      FollowResolvedPath: 'CharacterFollowRoute',
      Wait: 'CharacterWait',
      MoveBackward: 'CharacterStepBack',
      RotateInPlace: 'CharacterTurnInPlace',
      HoldPosition: 'CharacterHoldPosition',
      GoalUpdated: 'CharacterGoalUpdated',
      GoalReached: 'CharacterGoalReached',
      IsBatteryLow: 'CharacterLowStamina',
      RefreshNavigation: 'CharacterRefreshNavigation',
    };

    return {
      ...action,
      embodimentAction: nameMap[action.name] || action.name,
    };
  }
}
