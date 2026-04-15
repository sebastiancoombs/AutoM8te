# AutoM8te Backend Adapter Contract
## Mapping composer intent into backend-native behavior systems

## Purpose
Define the contract for backend adapters.

Backend adapters are responsible for taking the **composer intent language** and mapping it into a backend-native behavior and execution system.

Examples of backend-native behavior systems:
- Unreal Behavior Trees / Blackboard / EQS / AI Controller
- Nav2 / BT.CPP / ROS2 navigation behaviors
- future robot-specific stacks

The backend adapter is where backend differences are resolved.
The composer intent language remains stable above it.

---

## 1. Core principle

AutoM8te does not require all backends to share the same primitive library.

Instead:
- AutoM8te defines a stable intent composition surface
- each backend adapter maps that intent into its native behavior vocabulary

### This means
- Unreal and Nav2 can both be valid backends
- their behavior libraries can differ
- the adapter is responsible for making the mapping coherent

---

## 2. What the adapter must do

A backend adapter must:

### 2.1 Accept validated composer intent
Input is a valid intent composition program plus resolved world context.

### 2.2 Map structural composition into backend-native structures
Examples:
- `sequence` → Unreal BT Sequence / BT.CPP Sequence
- `fallback` → Unreal Selector / BT.CPP Fallback
- `retry` → backend-supported retry structure
- `repeat` → backend continuous loop form
- `guard` → decorators / conditions
- `timeout` → timeout decorator or equivalent runtime wrapper

### 2.3 Map operations into backend-native behaviors
Examples:
- `navigate_to`
- `compute_path`
- `follow_path`
- `wait`
- `backup`
- `spin`
- `hold_position`
- `goal_updated`
- `goal_reached`
- `clear_costmap`

Each backend may realize these differently.

### 2.4 Bind runtime state
The adapter must inject actor-specific and goal-specific data into the backend runtime.

### 2.5 Produce a launchable backend execution package
This could be:
- Unreal assets / controller commands / runtime config
- Nav2 BT XML + blackboard + action bindings
- later backend-native execution objects

### 2.6 Report execution state back upward
The adapter must expose run status in a normalized format.

---

## 3. What the adapter must NOT do

The adapter must not:
- invent new product-level intent semantics
- create hidden mission logic outside the intent language
- move planning logic into the backend
- change the meaning of the composer language silently
- become the source of truth for orchestration decisions

The adapter is a translator, not the planner.

---

## 4. Input contract

Each adapter receives:

### 4.1 Composer intent
A validated `Intent Composition Language` object.

### 4.2 Resolved world context
A backend-agnostic state object containing the resolved references needed for compilation.

### 4.3 Actor binding
The actor or actor set this run applies to.

### 4.4 Runtime metadata
Optional execution metadata such as run id, labels, priority, or owner.

---

## 5. Normalized input shape

```ts
type AdapterInput = {
  runId: string
  actorIds: string[]
  intent: Record<string, any>
  resolvedContext: Record<string, any>
  metadata?: Record<string, any>
}
```

For the first layer, `actorIds` should contain exactly one actor.

---

## 6. Normalized output shape

The adapter must return a normalized execution package.

```ts
type AdapterOutput = {
  backend: string
  runId: string
  actorIds: string[]
  backendPackage: Record<string, any>
  executionHints?: Record<string, any>
  metadata?: Record<string, any>
}
```

The contents of `backendPackage` are backend-specific.

---

## 7. Normalized run status

Every adapter should translate backend execution status into a normalized status form.

```ts
type NormalizedRunStatus = {
  runId: string
  backend: string
  actorIds: string[]
  status: 'created' | 'running' | 'completed' | 'failed' | 'stopped'
  currentBehavior?: string
  currentGoal?: string
  warnings?: string[]
  errors?: string[]
  rawBackendState?: Record<string, any>
}
```

This prevents orchestration logic from depending on backend-specific state formats.

---

## 8. Structural mapping rules

The adapter must map the composition language structure into the backend’s behavior model.

## 8.1 Sequence
- Unreal: BT Sequence
- Nav2/BT.CPP: Sequence node

## 8.2 Fallback
- Unreal: Selector
- Nav2/BT.CPP: Fallback / ReactiveFallback depending on semantics

## 8.3 Retry
- Unreal: supported retry logic through decorators/tasks/services or generated wrapper
- Nav2/BT.CPP: Retry decorator or equivalent XML structure

## 8.4 Repeat
- Unreal: looping service/decorator/task structure or repeated tree pattern
- Nav2/BT.CPP: Repeat decorator / continuous tree pattern

## 8.5 Guard
- Unreal: Blackboard/decorator condition
- Nav2/BT.CPP: condition node or decorator-gated child

## 8.6 Timeout
- Unreal: timeout task/decorator pattern
- Nav2/BT.CPP: Timeout decorator

### Important rule
The adapter may change representation, but not intent meaning.

---

## 9. Operation mapping rules

The adapter must define explicit mapping tables from composer operations to backend-native behaviors.

### Example mapping categories

#### `navigate_to`
- Unreal: AI Move To / BT Move To / controller goal task
- Nav2: NavigateToPose or ComputePath+FollowPath composition

#### `compute_path`
- Unreal: EQS/nav query or backend-native path computation equivalent
- Nav2: ComputePathToPose

#### `follow_path`
- Unreal: path following task/controller path execution
- Nav2: FollowPath

#### `wait`
- Unreal: Wait task
- Nav2: Wait node

#### `backup`
- Unreal: movement reverse behavior if available or backend equivalent
- Nav2: BackUp

#### `spin`
- Unreal: rotate/turn task
- Nav2: Spin

#### `goal_updated`
- Unreal: blackboard/decorator/service condition
- Nav2: GoalUpdated node or equivalent condition mapping

#### `goal_reached`
- Unreal: goal/position check decorator or task result check
- Nav2: GoalReached node or equivalent goal checker

#### `hold_position`
- Unreal: move/hold task or idle-at-location behavior
- Nav2: stop/hold wrapper behavior or navigate-to-current-pose equivalent

#### `clear_costmap`
- Unreal: usually no direct equivalent; may map to noop, refresh nav, or be unsupported
- Nav2: ClearCostmap service/action node

---

## 10. Unsupported operation handling

Backends will not support everything equally.

### The adapter must support one of these outcomes:
1. direct mapping
2. equivalent mapping
3. explicit unsupported error
4. explicitly documented noop mapping if safe and intentional

### The adapter must not silently drop intent.

---

## 11. Backend-specific examples

## 11.1 Unreal backend adapter

### Likely outputs
- Behavior Tree asset selection or generation
- Blackboard value bindings
- AI Controller run instruction
- EQS query bindings where applicable
- nav target bindings

### Strengths
- strong simulation-native behavior stack
- built-in movement and environment reasoning
- Mac-friendly

### Constraints
- behavior vocabulary differs from Nav2
- some robotics-specific semantics may not exist directly

---

## 11.2 Nav2 backend adapter

### Likely outputs
- BT XML
- blackboard initialization
- NavigateToPose / FollowPath / recovery bindings
- runtime execution config

### Strengths
- strong navigation behavior library
- robotics-standard execution behavior
- BT.CPP-native semantics

### Constraints
- Linux / ROS2 runtime assumptions
- less native for game-engine-only workflows

---

## 12. Required adapter capabilities

Every backend adapter should implement at least these methods:

```ts
type BackendAdapter = {
  validateSupport(input: AdapterInput): Promise<{ ok: boolean; errors?: string[] }>
  compile(input: AdapterInput): Promise<AdapterOutput>
  start(output: AdapterOutput): Promise<NormalizedRunStatus>
  status(runId: string): Promise<NormalizedRunStatus>
  stop(runId: string): Promise<NormalizedRunStatus>
  update?(runId: string, patch: Record<string, any>): Promise<NormalizedRunStatus>
}
```

---

## 13. First-layer constraint

For the first single-robot layer:
- one actor only
- one active run per actor
- one backend adapter selected per run
- continuous execution as the default mode

This keeps the first implementation simple.

---

## 14. Why this contract matters

This contract gives AutoM8te:
- one stable model-facing language
- multiple backend behavior systems
- no requirement for identical primitive libraries
- clean sim-to-real portability
- no need to rewrite behavior runtimes

This is the central mechanism that preserves architectural flexibility.

---

## 15. Short version

The backend adapter contract says:
- the model emits one stable composition language
- the adapter maps that into backend-native behavior systems
- Unreal and Nav2 can both be valid backends
- backend behavior libraries do not need to be identical
- the adapter preserves intent while translating execution

That is how AutoM8te stays backend agnostic without becoming a custom behavior runtime.
