import { UnrealEmbodimentAdapter } from './unreal-embodiment-adapter.js';

export class UnrealAircraftEmbodimentAdapter extends UnrealEmbodimentAdapter {
  constructor(options = {}) {
    super({
      profile: 'aircraft',
      actorClass: 'BP_Aircraft',
      controller: 'BP_AircraftController',
      ...options,
    });
  }

  mapAction(action) {
    const nameMap = {
      MoveTo: 'AircraftMoveToTarget',
      RunEQSOrPathQuery: 'AircraftBuildRoute',
      FollowResolvedPath: 'AircraftFollowRoute',
      Wait: 'AircraftHoldPattern',
      MoveBackward: 'AircraftReverse',
      RotateInPlace: 'AircraftAdjustYaw',
      HoldPosition: 'AircraftHoldPosition',
      GoalUpdated: 'AircraftGoalUpdated',
      GoalReached: 'AircraftGoalReached',
      IsBatteryLow: 'AircraftBatteryLow',
      RefreshNavigation: 'AircraftRefreshNavigation',
    };

    return {
      ...action,
      embodimentAction: nameMap[action.name] || action.name,
    };
  }
}
