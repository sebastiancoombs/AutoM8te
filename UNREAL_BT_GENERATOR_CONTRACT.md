# Unreal BT Generator Contract

## Purpose
Define the Unreal-native generation target for AutoM8te's Unreal adapter.

The Unreal adapter is not an executor.
It is an adapter/generator that should produce Unreal-native execution structures.

For Unreal, the native target is:
- Behavior Tree structure
- Blackboard schema and bindings
- task/decorator/service references
- embodiment-specific leaf bindings

This keeps execution inside Unreal's runtime model.

---

## 1. Core principle
AutoM8te should generate a **BT specification**, not a fake runtime action loop.

That BT specification can later be:
- translated into real Unreal assets
- bound to an AIController
- patched via Blackboard updates
- re-generated when required

---

## 2. Normalized generated output
The Unreal adapter should ultimately emit a backend package shaped like this:

```ts
type UnrealGeneratedPackage = {
  backend: 'unreal'
  actorId: string
  embodimentProfile?: string
  aiController: string
  blackboard: UnrealBlackboardSpec
  behaviorTree: UnrealBehaviorTreeSpec
  bindings?: Record<string, any>
  metadata?: Record<string, any>
}
```

---

## 3. Blackboard spec
```ts
type UnrealBlackboardSpec = {
  keys: {
    name: string
    type: 'Bool' | 'Int' | 'Float' | 'String' | 'Vector' | 'Object' | 'Enum'
    defaultValue?: any
  }[]
  values: Record<string, any>
}
```

### Minimum stable keys
- `actor_id`
- `mode`
- `goal_id`
- `goal_location`
- `current_behavior`
- `interrupt_requested`
- `target_visible`
- `health_state`

Backends/embodiments may add more keys.
The shared meaning of core keys should remain stable.

---

## 4. Behavior Tree spec
```ts
type UnrealBehaviorTreeSpec = {
  root: UnrealBTNode
}

type UnrealBTNode =
  | { kind: 'Sequence'; children: UnrealBTNode[] }
  | { kind: 'Selector'; children: UnrealBTNode[] }
  | { kind: 'Retry'; times?: number; child: UnrealBTNode }
  | { kind: 'Loop'; child: UnrealBTNode }
  | { kind: 'Guard'; condition: UnrealBTNode; child: UnrealBTNode }
  | { kind: 'Timeout'; duration_s: number; child: UnrealBTNode }
  | { kind: 'Task'; task: string; params?: Record<string, any> }
  | { kind: 'Decorator'; task: string; params?: Record<string, any> }
  | { kind: 'Service'; task: string; params?: Record<string, any> }
```

This is the generated tree spec the adapter owns.
It should mirror intent composition meaning while staying close to Unreal BT structure.

---

## 5. Embodiment leaf bindings
Embodiment-specific differences should live at the leaf binding level.

Examples:
- aircraft task bindings
- vehicle task bindings
- character task bindings

That means:
- tree structure stays stable
- Blackboard semantics stay mostly stable
- leaf references swap per embodiment

---

## 6. Generator output vs runtime execution
The generator's job is to produce:
- tree spec
- Blackboard spec
- leaf references
- controller binding

The runtime's job is to:
- execute the BT
- tick services/decorators/tasks
- update Blackboard
- emit authoritative state

Those responsibilities must remain separate.

---

## 7. Patch model
Not every change should rebuild the tree.

### Cheap patches
- update Blackboard values
- swap goal id / location
- set behavior flags

### Medium patches
- restart subtree
- pause/resume controller runtime

### Heavy patches
- regenerate BT specification
- rebind leaf tasks
- relaunch run package

---

## 8. MCP role
MCP is the tool/build/control surface.
It can help:
- inspect assets
- inspect project structure
- generate or update assets
- run Python authoring scripts
- launch/editor-bind generated artifacts

But MCP is not itself the behavior runtime.

---

## 9. Unreal adapter target
So the Unreal adapter should aim to generate:

1. **BT specification**
2. **Blackboard specification**
3. **embodiment leaf bindings**
4. **controller/runtime metadata**

That is the correct Unreal-native output target.

---

## 10. Short version
The Unreal adapter is a BT/Blackboard/task generator.

It should generate Unreal-native execution structures.
It should not become a custom runtime loop.
