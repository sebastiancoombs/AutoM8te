import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntentDocument, validateMissionIntent, expandMissionIntent, compileToRunPackage, SingleRobotRunManager, Nav2BackendAdapter, UnrealBackendAdapter, translateUnrealState, translateRealState, projectWorldState, UnrealConsumer, Nav2Consumer, ConsumerManager, ZenohStateFabric, StatePublisher, UnrealBridge, UnrealDispatcher, UnrealStateClient, UnrealMcpTransport, GenericUnrealEmbodimentAdapter, UnrealAircraftEmbodimentAdapter, UnrealVehicleEmbodimentAdapter, UnrealCharacterEmbodimentAdapter, getUnrealActionSpec } from './index.js';

const sample = {
  version: 'v1',
  actor: { id: 'robot_1' },
  mode: 'continuous',
  root: {
    type: 'fallback',
    children: [
      {
        type: 'sequence',
        children: [
          { op: 'compute_path', goal: 'target_goal' },
          { op: 'follow_path' },
        ],
      },
      {
        type: 'sequence',
        children: [
          { op: 'clear_costmap', scope: 'both' },
          { op: 'backup', distance_m: 1.0 },
          { op: 'spin', angle_rad: 1.57 },
        ],
      },
    ],
  },
};

test('validate sample intent', () => {
  const result = validateIntentDocument(sample);
  assert.equal(result.ok, true);
});

test('validate simple mission intent', () => {
  const mission = {
    version: 'v1',
    intent: 'search',
    actors: { type: 'copter', count: 5, startup: 'launch' },
    target: { query: 'red car' },
    policy: { mode: 'continuous', on_find: 'report_and_hold' },
  };
  const result = validateMissionIntent(mission);
  assert.equal(result.ok, true);
});

test('expand simple mission intent into per-actor runs', () => {
  const mission = {
    version: 'v1',
    intent: 'search',
    actors: { type: 'copter', count: 5, startup: 'launch' },
    target: { query: 'red car' },
    policy: { mode: 'continuous', on_find: 'report_and_hold' },
  };

  const expanded = expandMissionIntent(mission);
  assert.equal(expanded.runs.length, 5);
  assert.equal(expanded.runs[0].actor.id, 'copter_1');
  assert.equal(expanded.runs[0].metadata.target_query, 'red car');
  assert.equal(expanded.coordination.strategy, 'sector_search');
});

test('compile to xml package', () => {
  const pkg = compileToRunPackage(sample, { runId: 'run_1' });
  assert.equal(pkg.runId, 'run_1');
  assert.match(pkg.xml, /<BehaviorTree ID="MainTree">/);
  assert.match(pkg.xml, /<ComputePathToPose goal="target_goal" \/>/);
});

test('run manager lifecycle', async () => {
  const mgr = new SingleRobotRunManager(new Nav2BackendAdapter());
  const runPackage = await mgr.createRun(sample, { goals: { target_goal: { x: 1, y: 2 } } }, { runId: 'run_2' });
  const started = await mgr.startRun(runPackage);
  assert.equal(started.status, 'running');
  const status = await mgr.getRunStatus('run_2');
  assert.equal(status.status, 'running');
  const stopped = await mgr.stopRun('run_2');
  assert.equal(stopped.status, 'stopped');
});

test('unreal adapter compiles single-robot behavior tree package', async () => {
  const adapter = new UnrealBackendAdapter();
  const support = await adapter.validateSupport({ runId: 'run_3', actorIds: ['robot_1'], intent: sample, resolvedContext: { goals: { target_goal: { x: 1, y: 2 } } } });
  assert.equal(support.ok, true);

  const compiled = await adapter.compile({ runId: 'run_3', actorIds: ['robot_1'], intent: sample, resolvedContext: { goals: { target_goal: { x: 1, y: 2 } } } });
  assert.equal(compiled.backend, 'unreal');
  assert.equal(compiled.backendPackage.aiController, 'AutoMateAIController');
  assert.equal(compiled.backendPackage.behaviorTree.root.kind, 'Selector');
  assert.ok(Array.isArray(compiled.backendPackage.blackboard.keys));
  assert.equal(compiled.backendPackage.blackboard.values.actor_id, 'robot_1');
  assert.equal(compiled.backendPackage.blackboard.values.goal_id, 'target_goal');

  const started = await adapter.start(compiled);
  assert.equal(started.status, 'running');
  const stopped = await adapter.stop('run_3');
  assert.equal(stopped.status, 'stopped');
});

test('translate unreal state into normalized projection', () => {
  const world = translateUnrealState({
    actors: [{ id: 'drone_1', type: 'floating_pawn', x: 1, y: 2, z: 3, status: 'moving', camera: true }],
    goals: { waypoint_a: { x: 10, y: 20, z: 30 } },
    observations: { drone_1: [{ id: 'car_1', class: 'car', confidence: 0.91, position: [4, 5, 0] }] },
    runs: { run_1: { actorIds: ['drone_1'], status: 'running' } },
  });
  assert.equal(world.backend, 'unreal');
  assert.equal(world.actors.drone_1.kind, 'floating_pawn');
  assert.equal(world.goals.waypoint_a.pose.x, 10);
  assert.equal(world.observations.drone_1[0].type, 'car');
  assert.equal(world.runs.run_1.status, 'running');
});

test('translate real/nav state into normalized projection', () => {
  const world = translateRealState({
    backend: 'nav2',
    actors: [{ id: 'robot_1', position: [7, 8, 0], mode: 'navigating', battery: 0.5, capabilities: { move: true } }],
    goals: { target_goal: { position: [9, 10, 0] } },
    observations: { robot_1: [{ track_id: 'person_1', class: 'person', confidence: 0.8 }] },
  });
  assert.equal(world.backend, 'nav2');
  assert.equal(world.actors.robot_1.pose.x, 7);
  assert.equal(world.actors.robot_1.health, 'ok');
  assert.equal(world.goals.target_goal.pose.x, 9);
  assert.equal(world.observations.robot_1[0].id, 'person_1');
});

test('projectWorldState dispatches by backend', () => {
  const unreal = projectWorldState({ backend: 'unreal', payload: { actors: [{ id: 'a1' }] } });
  const nav = projectWorldState({ backend: 'nav2', payload: { actors: [{ id: 'r1' }] } });
  assert.equal(unreal.backend, 'unreal');
  assert.equal(nav.backend, 'nav2');
});

test('unreal consumer preserves blackboard and camera state', () => {
  const consumer = new UnrealConsumer();
  const world = consumer.consume({
    actors: [{
      id: 'drone_2',
      type: 'floating_pawn',
      x: 10,
      y: 20,
      z: 30,
      blackboard: { goal: 'waypoint_a', behavior: 'patrol' },
      camera: { fov: 90 },
      perception: { sight: true },
    }],
  });
  assert.equal(world.actors.drone_2.currentGoal, 'waypoint_a');
  assert.equal(world.actors.drone_2.currentBehavior, 'patrol');
  assert.equal(world.actors.drone_2.camera.mounted, true);
  assert.equal(world.actors.drone_2.perception.sight, true);
});

test('nav2 consumer preserves navigator state', () => {
  const consumer = new Nav2Consumer();
  const world = consumer.consume({
    actors: [{
      id: 'robot_2',
      position: [1, 2, 0],
      navigator_state: 'following_path',
      navigation_goal: 'target_goal',
      bt_tree: 'NavigateToPose',
      localization: { map: 'main' },
      costmaps: { local: 'ok' },
    }],
  });
  assert.equal(world.actors.robot_2.currentGoal, 'target_goal');
  assert.equal(world.actors.robot_2.currentBehavior, 'NavigateToPose');
  assert.equal(world.actors.robot_2.navigator, 'following_path');
  assert.equal(world.actors.robot_2.localization.map, 'main');
});

test('consumer manager handles multiple backend consumers and actor routing', () => {
  const manager = new ConsumerManager()
    .registerBackend('unreal', new UnrealConsumer())
    .registerBackend('nav2', new Nav2Consumer());

  const merged = manager.consumeMany([
    {
      backend: 'unreal',
      payload: {
        actors: [{ id: 'drone_1', type: 'floating_pawn', x: 0, y: 0, z: 10 }],
        goals: { waypoint_a: { x: 10, y: 0, z: 10 } },
      },
    },
    {
      backend: 'nav2',
      payload: {
        actors: [{ id: 'robot_3', position: [5, 5, 0], navigator_state: 'idle' }],
        goals: { dock_a: { position: [1, 1, 0] } },
      },
    },
  ]);

  assert.equal(merged.actors.drone_1.backend, 'unreal');
  assert.equal(merged.actors.robot_3.backend, 'nav2');
  assert.equal(manager.getBackendForActor('drone_1'), 'unreal');
  assert.equal(manager.getBackendForActor('robot_3'), 'nav2');
  assert.ok(manager.getConsumerForActor('drone_1') instanceof UnrealConsumer);
  assert.ok(manager.getConsumerForActor('robot_3') instanceof Nav2Consumer);
});

test('state publisher pushes backend truth into zenoh state fabric', async () => {
  const manager = new ConsumerManager()
    .registerBackend('unreal', new UnrealConsumer())
    .registerBackend('nav2', new Nav2Consumer());
  const fabric = new ZenohStateFabric();
  const publisher = new StatePublisher({ consumerManager: manager, stateFabric: fabric });

  await publisher.publishBackendState('unreal', {
    actors: [{ id: 'drone_9', type: 'floating_pawn', x: 4, y: 5, z: 6 }],
    goals: { waypoint_x: { x: 9, y: 9, z: 9 } },
  });

  await publisher.publishBackendState('nav2', {
    actors: [{ id: 'robot_9', position: [7, 8, 0], navigator_state: 'running' }],
  });

  const actorState = await fabric.getActorState('drone_9');
  const backendState = await fabric.queryState({ backend: 'unreal' });
  const fullState = await fabric.queryState();

  assert.equal(actorState.backend, 'unreal');
  assert.equal(backendState.backend, 'unreal');
  assert.equal(fullState.actors.robot_9.backend, 'nav2');
  assert.equal(fullState.goals.waypoint_x.pose.x, 9);
});

test('unreal action library exposes prebuilt tasks', () => {
  const moveTo = getUnrealActionSpec('MoveTo');
  assert.equal(moveTo.prebuilt, true);
  assert.equal(moveTo.category, 'movement');
});

test('unreal dispatcher builds generic dispatch payloads without executing behavior locally', async () => {
  const adapter = new UnrealBackendAdapter();
  const compiled = await adapter.compile({
    runId: 'run_dispatch_1',
    actorIds: ['drone_1'],
    intent: sample,
    resolvedContext: { goals: { target_goal: { x: 1, y: 2 } } },
  });

  const dispatcher = new UnrealDispatcher();
  const result = await dispatcher.dispatch({
    compiledRun: compiled,
    actor: { id: 'drone_1', actorClass: 'BP_Drone', controller: 'BP_DroneController', embodimentProfile: 'generic_unreal' },
  });

  assert.equal(result.status, 'dispatch-prepared');
  assert.equal(result.payload.dispatch.actorClass, 'BP_Drone');
  assert.ok(result.payload.dispatch.behaviorTree.root);
  assert.ok(result.payload.dispatch.blackboard.values);
  assert.ok(result.payload.dispatch.actions.some(a => a.name === 'RunEQSOrPathQuery'));
  assert.ok(result.payload.dispatch.actions.some(a => a.name === 'FollowResolvedPath'));
});

test('unreal state client stays transport-only without inventing state', async () => {
  const stateClient = new UnrealStateClient();
  const result = await stateClient.fetchState({ actorId: 'drone_1' });
  assert.equal(result.status, 'state-fetch-unavailable');
});

test('generic unreal embodiment adapter can be swapped independently', () => {
  const embodiment = new GenericUnrealEmbodimentAdapter();
  const actionGraph = embodiment.buildActionGraph({
    backendPackage: {
      actorId: 'drone_1',
      aiController: 'AIController',
      blackboard: { goal: 'target_goal' },
      behaviorTree: {
        root: {
          kind: 'Sequence',
          children: [
            { kind: 'Task', task: 'RunEQSOrPathQuery', params: { goal: 'target_goal' } },
            { kind: 'Task', task: 'FollowResolvedPath', params: {} },
          ],
        },
      },
    },
    actor: { actorClass: 'BP_Character', controller: 'BP_CharacterController' },
  });

  assert.equal(actionGraph.actorClass, 'BP_Character');
  assert.equal(actionGraph.controller, 'BP_CharacterController');
  assert.equal(actionGraph.actions.length, 2);
});

test('aircraft, vehicle, and character embodiment adapters remap actions independently', () => {
  const backendPackage = {
    actorId: 'unit_1',
    aiController: 'AIController',
    blackboard: {},
    behaviorTree: {
      root: {
        kind: 'Sequence',
        children: [
          { kind: 'Task', task: 'MoveTo', params: { goal: 'target_goal' } },
          { kind: 'Task', task: 'FollowResolvedPath', params: {} },
        ],
      },
    },
  };

  const aircraft = new UnrealAircraftEmbodimentAdapter().buildActionGraph({ backendPackage });
  const vehicle = new UnrealVehicleEmbodimentAdapter().buildActionGraph({ backendPackage });
  const character = new UnrealCharacterEmbodimentAdapter().buildActionGraph({ backendPackage });

  assert.equal(aircraft.embodimentProfile, 'aircraft');
  assert.equal(vehicle.embodimentProfile, 'vehicle');
  assert.equal(character.embodimentProfile, 'character');
  assert.equal(aircraft.actions[0].embodimentAction, 'AircraftMoveToTarget');
  assert.equal(vehicle.actions[0].embodimentAction, 'VehicleDriveToTarget');
  assert.equal(character.actions[0].embodimentAction, 'CharacterMoveToTarget');
});

test('unreal state client delegates to a transport implementation', async () => {
  const transport = {
    async fetchState(query) {
      return {
        status: 'state-fetched-via-mcp',
        query,
        payload: {
          actors: [{ id: 'drone_1', type: 'Pawn', x: 1, y: 2, z: 3 }],
        },
      };
    },
  };

  const client = new UnrealStateClient({ transport });
  const result = await client.fetchState({ actorId: 'drone_1' });
  assert.equal(result.status, 'state-fetched-via-mcp');
  assert.equal(result.payload.actors[0].id, 'drone_1');

  const worldState = await client.getNormalizedWorldState({ actorId: 'drone_1' });
  assert.equal(worldState.backend, 'unreal');
  assert.equal(worldState.state.actors[0].id, 'drone_1');

  const feedback = client.buildFeedbackEvents(worldState, { actorId: 'drone_1' });
  assert.equal(feedback[0].kind, 'state');
  assert.equal(feedback[0].actorIds[0], 'drone_1');
});

test('unreal bridge registers actors, ingests state, and prepares dispatch', async () => {
  const fabric = new ZenohStateFabric();
  const bridge = new UnrealBridge({ stateFabric: fabric });

  bridge.registerActor({ id: 'drone_1' });
  assert.equal(bridge.listActors().length, 1);

  const projection = await bridge.ingestState({
    actors: [{ id: 'drone_1', type: 'floating_pawn', x: 1, y: 2, z: 3 }],
  });
  assert.equal(projection.actors.drone_1.backend, 'unreal');

  const compiled = await bridge.compileRun({
    runId: 'run_unreal_1',
    actorIds: ['drone_1'],
    intent: sample,
    resolvedContext: { goals: { target_goal: { x: 1, y: 2 } } },
  });
  assert.equal(compiled.backend, 'unreal');

  const started = await bridge.startRun({
    runId: 'run_unreal_2',
    actorIds: ['drone_1'],
    intent: sample,
    resolvedContext: { goals: { target_goal: { x: 1, y: 2 } } },
  });
  assert.equal(started.status, 'running');
  assert.equal(started.dispatch.actorId, 'drone_1');
  assert.equal(started.dispatchStatus, 'dispatch-prepared');
  assert.equal(started.feedbackLoop.backend, 'unreal');
  assert.ok(started.dispatch.behaviorTree.root);
  assert.ok(started.dispatch.blackboard.values);
  assert.ok(started.dispatch.actions.some(a => a.name === 'RunEQSOrPathQuery'));
  assert.ok(started.dispatch.actions.some(a => a.name === 'FollowResolvedPath'));
});
