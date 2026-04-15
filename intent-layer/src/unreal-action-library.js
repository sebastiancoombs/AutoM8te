export const UNREAL_ACTION_LIBRARY = {
  MoveTo: {
    category: 'movement',
    prebuilt: true,
    requires: ['goal'],
  },
  RunEQSOrPathQuery: {
    category: 'planning',
    prebuilt: true,
    requires: ['goal'],
  },
  FollowResolvedPath: {
    category: 'movement',
    prebuilt: true,
    requires: [],
  },
  Wait: {
    category: 'control',
    prebuilt: true,
    requires: ['duration_s'],
  },
  MoveBackward: {
    category: 'recovery',
    prebuilt: true,
    requires: ['distance_m'],
  },
  RotateInPlace: {
    category: 'recovery',
    prebuilt: true,
    requires: ['angle_rad'],
  },
  HoldPosition: {
    category: 'control',
    prebuilt: true,
    requires: [],
  },
  GoalUpdated: {
    category: 'condition',
    prebuilt: true,
    requires: [],
  },
  GoalReached: {
    category: 'condition',
    prebuilt: true,
    requires: [],
  },
  IsBatteryLow: {
    category: 'condition',
    prebuilt: true,
    requires: ['threshold'],
  },
  RefreshNavigation: {
    category: 'recovery',
    prebuilt: true,
    requires: ['scope'],
  },
};

export function getUnrealActionSpec(taskName) {
  return UNREAL_ACTION_LIBRARY[taskName] || null;
}
