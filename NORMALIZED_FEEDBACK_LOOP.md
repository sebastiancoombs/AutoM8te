# Normalized Feedback Loop

## Purpose
Define the backend-agnostic execution and feedback core for AutoM8te.

This is the loop that should remain stable across:
- Unreal
- Nav2
- future real robot backends

Backend adapters may differ in how they realize execution.
They should not differ in the shape of the core feedback loop unless absolutely necessary.

---

## 1. Principle
AutoM8te should use one normalized execution loop:

1. generate execution package
2. dispatch to backend-native runtime
3. receive authoritative state + run feedback
4. normalize that feedback
5. decide whether to continue, patch, interrupt, or regenerate

This keeps orchestration logic portable across backends.

---

## 2. Core objects

## 2.1 Execution package
A normalized execution package is the thing the adapter/generator produces before backend dispatch.

```ts
type ExecutionPackage = {
  backend: string
  runId: string
  actorIds: string[]
  backendPackage: Record<string, any>
  metadata?: Record<string, any>
}
```

---

## 2.2 Dispatch payload
A dispatch payload is the backend-ready action/config object handed to the runtime edge.

```ts
type DispatchPayload = {
  backend: string
  runId: string
  actorIds: string[]
  embodimentProfile?: string
  dispatch: Record<string, any>
  metadata?: Record<string, any>
}
```

---

## 2.3 Patch event
Patch events are the normalized interrupt/update mechanism.

```ts
type PatchEvent = {
  runId: string
  actorIds?: string[]
  type: 'blackboard_update' | 'goal_update' | 'behavior_flag' | 'cancel' | 'resume' | 'restart_subtree' | 'regenerate'
  payload: Record<string, any>
  metadata?: Record<string, any>
}
```

### Patch priority model
- **cheap patch**: update Blackboard or goal
- **medium patch**: restart subtree / pause / resume
- **heavy patch**: regenerate package and redispatch

Not every change should force regeneration.

---

## 2.4 Normalized run status
```ts
type NormalizedRunStatus = {
  runId: string
  backend: string
  actorIds: string[]
  status: 'created' | 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted'
  currentBehavior?: string
  currentGoal?: string
  warnings?: string[]
  errors?: string[]
  rawBackendState?: Record<string, any>
}
```

---

## 2.5 Normalized world state
```ts
type NormalizedWorldState = {
  backend: string
  actors: Record<string, any>
  goals: Record<string, any>
  observations: Record<string, any>
  runs: Record<string, any>
  raw?: Record<string, any>
}
```

---

## 2.6 Feedback event
```ts
type FeedbackEvent = {
  runId?: string
  backend: string
  actorIds?: string[]
  kind: 'state' | 'status' | 'warning' | 'error' | 'goal_reached' | 'goal_changed' | 'target_lost' | 'interrupt_ack'
  data: Record<string, any>
  timestamp?: string
}
```

This is the event shape the orchestrator should consume, regardless of backend.

---

## 3. Core loop

## 3.1 Generate
The adapter/generator creates a backend-native execution package.

## 3.2 Dispatch
The backend edge translates that package into a backend-native runtime invocation.

## 3.3 Observe
The backend edge streams or polls authoritative state and execution status.

## 3.4 Normalize
The consumer layer normalizes state and feedback into the shared core structures.

## 3.5 Decide
The orchestrator decides one of:
- continue unchanged
- cheap patch
- medium patch
- heavy regeneration
- stop/cancel

---

## 4. Required invariants
These should remain stable across backends.

### 4.1 Run identity
Every run has a stable `runId`.

### 4.2 Actor identity
Every actor has a stable actor id / binding.

### 4.3 Runtime is authoritative
The backend runtime owns execution truth.
AutoM8te must not invent authoritative state.

### 4.4 Patch semantics are normalized
Goal change means the same thing across Unreal and Nav2, even if implementation differs.

### 4.5 Feedback categories are normalized
Warnings, errors, status, and state updates should surface in one shared vocabulary.

---

## 5. Backend-specific edge responsibilities

## 5.1 Unreal edge
Unreal-specific code may differ in:
- Behavior Tree representation
- Blackboard representation
- Blueprint/C++ task binding
- runtime invocation method
- state extraction path

But it should still emit normalized run state and feedback.

## 5.2 Nav2 edge
Nav2-specific code may differ in:
- BT XML format
- blackboard/runtime config
- action server semantics
- recovery node semantics
- state extraction path

But it should still emit normalized run state and feedback.

---

## 6. Streaming model
The system should feel continuous like a game/runtime loop.
That does **not** mean AutoM8te owns the low-level tick loop.

Instead:
- Unreal/Nav2 own the tick/runtime loop
- AutoM8te owns generation, patching, and orchestration
- feedback is consumed as a stream or polling loop into normalized core state

---

## 7. Why this exists
Without a normalized feedback loop, each backend grows its own orchestration logic.
That would fork the architecture and break the digital twin goal.

With a normalized feedback loop:
- orchestration stays portable
- embodiments stay swappable
- backend differences stay at the edge
- the same feedback logic works across sim and real

---

## 8. Short version
One shared core:
- execution package
- dispatch payload
- patch event
- normalized run status
- normalized world state
- feedback event

Backend edges differ.
The feedback loop does not.
