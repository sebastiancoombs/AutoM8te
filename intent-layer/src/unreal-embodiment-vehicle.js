import { UnrealEmbodimentAdapter } from './unreal-embodiment-adapter.js';

export class UnrealVehicleEmbodimentAdapter extends UnrealEmbodimentAdapter {
  constructor(options = {}) {
    super({
      profile: 'vehicle',
      actorClass: 'BP_Vehicle',
      controller: 'BP_VehicleController',
      ...options,
    });
  }

  mapAction(action) {
    const nameMap = {
      MoveTo: 'VehicleDriveToTarget',
      RunEQSOrPathQuery: 'VehicleBuildRoute',
      FollowResolvedPath: 'VehicleFollowRoute',
      Wait: 'VehicleIdleAtLocation',
      MoveBackward: 'VehicleReverse',
      RotateInPlace: 'VehicleSteerInPlace',
      HoldPosition: 'VehicleHoldBrake',
      GoalUpdated: 'VehicleGoalUpdated',
      GoalReached: 'VehicleGoalReached',
      IsBatteryLow: 'VehicleBatteryLow',
      RefreshNavigation: 'VehicleRefreshNavigation',
    };

    return {
      ...action,
      embodimentAction: nameMap[action.name] || action.name,
    };
  }
}
