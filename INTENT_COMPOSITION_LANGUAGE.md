# AutoM8te Intent Composition Language
## A constrained language for LLM-composed continuous robot behavior

## Purpose
Define the structured language that the LLM will use to compose behaviors.

This is the layer between:
- model reasoning
- and backend execution through Nav2 / BT.CPP

The model should **not** generate raw BT.CPP XML.
The model should **not** generate arbitrary code.
The model should generate a **simple, validated intent tree/list** using a constrained composition language.

AutoM8te then compiles that intent language into the runtime backend.

---

## 1. Core principle

The model is allowed to compose behavior.
It is **not** allowed to invent runtime semantics.

That means the model may:
- sequence known operations
- use known fallbacks
- add retries / repetition / guards
- bind parameters
- select targets / actors / goals

But it must do so using an explicit language that the backend can validate.

---

## 2. Design goals

The language should be:
- simple enough for an LLM to use reliably
- expressive enough for continuous single-robot behaviors
- backend agnostic at the intent level
- compilable into Nav2 / BT.CPP
- easy to validate before execution
- human-readable and easy to debug

---

## 3. Scope of v1

This language is for:
- **single robot** behavior
- **continuous execution**
- **navigation-centered composition**
- **safe constrained generation**

It is not yet for:
- multi-robot synchronization
- arbitrary distributed planning
- freeform runtime logic
- backend-specific hacks

---

## 4. Top-level shape

A valid intent document should look like this:

```json
{
  "version": "v1",
  "actor": {
    "id": "robot_1"
  },
  "mode": "continuous",
  "root": {
    "type": "sequence",
    "children": [
      { "op": "navigate_to", "goal": "waypoint_a" },
      { "op": "wait", "duration_s": 2 },
      { "op": "navigate_to", "goal": "waypoint_b" }
    ]
  }
}
```

---

## 5. Top-level fields

## `version`
Currently only:
- `"v1"`

## `actor`
The execution target.

### Example
```json
{
  "id": "robot_1"
}
```

## `mode`
Execution mode.

Allowed values:
- `"continuous"`
- `"discrete"`

For v1, `continuous` is the default and preferred mode.

## `root`
The root node of the composition tree.

---

## 6. Node categories

There are only two node categories in v1:

1. **structural nodes**
2. **operation nodes**

---

## 7. Structural nodes

Structural nodes define control flow.
They do not perform robot actions themselves.

## 7.1 Sequence
Execute children in order.

### Shape
```json
{
  "type": "sequence",
  "children": [ ... ]
}
```

### Meaning
- do child 1
- then child 2
- then child 3
- fail if a child fails

---

## 7.2 Fallback
Try children in order until one succeeds.

### Shape
```json
{
  "type": "fallback",
  "children": [ ... ]
}
```

### Meaning
- try first option
- if it fails, try the next
- continue until one succeeds

---

## 7.3 Retry
Retry a child operation/subtree a limited number of times.

### Shape
```json
{
  "type": "retry",
  "times": 3,
  "child": { ... }
}
```

---

## 7.4 Repeat
Repeat a child behavior.

### Shape
```json
{
  "type": "repeat",
  "child": { ... }
}
```

For v1, `repeat` means repeat indefinitely unless stopped.

---

## 7.5 Guard
Only execute a child if a condition is satisfied.

### Shape
```json
{
  "type": "guard",
  "condition": { ... },
  "child": { ... }
}
```

---

## 7.6 Timeout
Bound a child with a timeout.

### Shape
```json
{
  "type": "timeout",
  "duration_s": 10,
  "child": { ... }
}
```

---

## 8. Operation nodes

Operation nodes are the leaves of the composition tree.
They represent known executable actions or checks.

The LLM must choose from the allowed operation list only.

---

## 9. Allowed v1 operations

This set is intentionally small.

## 9.1 `navigate_to`
Move to a target goal.

### Shape
```json
{
  "op": "navigate_to",
  "goal": "waypoint_a"
}
```

### Params
- `goal`: string or goal reference

---

## 9.2 `compute_path`
Request planning toward a goal.

### Shape
```json
{
  "op": "compute_path",
  "goal": "target_goal"
}
```

---

## 9.3 `follow_path`
Execute a previously computed path.

### Shape
```json
{
  "op": "follow_path"
}
```

---

## 9.4 `wait`
Pause for a bounded time.

### Shape
```json
{
  "op": "wait",
  "duration_s": 2
}
```

---

## 9.5 `backup`
Move backward as a recovery behavior.

### Shape
```json
{
  "op": "backup",
  "distance_m": 1.0
}
```

---

## 9.6 `spin`
Rotate in place as a recovery or search behavior.

### Shape
```json
{
  "op": "spin",
  "angle_rad": 1.57
}
```

---

## 9.7 `hold_position`
Stay at the current or specified position.

### Shape
```json
{
  "op": "hold_position"
}
```

---

## 9.8 `goal_updated`
Condition-like operation that checks if the goal has changed.

### Shape
```json
{
  "op": "goal_updated"
}
```

---

## 9.9 `goal_reached`
Condition-like operation that checks if the goal is reached.

### Shape
```json
{
  "op": "goal_reached"
}
```

---

## 9.10 `is_battery_low`
Condition-like operation.

### Shape
```json
{
  "op": "is_battery_low",
  "threshold": 0.2
}
```

---

## 9.11 `clear_costmap`
Recovery operation relevant to Nav2-style systems.

### Shape
```json
{
  "op": "clear_costmap",
  "scope": "local"
}
```

Allowed values for `scope`:
- `local`
- `global`
- `both`

---

## 10. Goals and references

In v1, goal references may be:
- literal names such as `"waypoint_a"`
- named world-model references such as `"target_goal"`
- named offsets computed upstream

The intent language does not define how a goal is resolved.
The backend/compiler is responsible for resolving goal references using the world model.

---

## 11. Conditions in v1

Conditions may appear inside `guard` nodes.

For v1, conditions are simply operation nodes used in condition position.

### Example
```json
{
  "type": "guard",
  "condition": { "op": "is_battery_low", "threshold": 0.2 },
  "child": { "op": "hold_position" }
}
```

---

## 12. Example compositions

## 12.1 Patrol loop
```json
{
  "version": "v1",
  "actor": { "id": "robot_1" },
  "mode": "continuous",
  "root": {
    "type": "repeat",
    "child": {
      "type": "sequence",
      "children": [
        { "op": "navigate_to", "goal": "waypoint_a" },
        { "op": "navigate_to", "goal": "waypoint_b" },
        { "op": "navigate_to", "goal": "waypoint_c" }
      ]
    }
  }
}
```

## 12.2 Navigate with recovery
```json
{
  "version": "v1",
  "actor": { "id": "robot_1" },
  "mode": "continuous",
  "root": {
    "type": "fallback",
    "children": [
      {
        "type": "sequence",
        "children": [
          { "op": "compute_path", "goal": "target_goal" },
          { "op": "follow_path" }
        ]
      },
      {
        "type": "sequence",
        "children": [
          { "op": "clear_costmap", "scope": "both" },
          { "op": "backup", "distance_m": 1.0 },
          { "op": "spin", "angle_rad": 1.57 }
        ]
      }
    ]
  }
}
```

## 12.3 Hold unless goal changes
```json
{
  "version": "v1",
  "actor": { "id": "robot_1" },
  "mode": "continuous",
  "root": {
    "type": "fallback",
    "children": [
      { "op": "goal_updated" },
      { "op": "hold_position" }
    ]
  }
}
```

---

## 13. Validation rules

The backend must validate all generated intent before execution.

### Required checks
- `version` must be supported
- `actor.id` must exist
- `mode` must be supported
- structural node types must be allowed
- operation names must be allowed
- required params for each operation must be present
- extra/unknown fields should either:
  - be rejected, or
  - be explicitly ignored with warnings
- recursion depth should be bounded
- composition size should be bounded

### Safety rule
If the generated intent fails validation, it must not be executed.

---

## 14. Compilation model

AutoM8te compiles this language into Nav2 / BT.CPP artifacts.

### The compiler should do
1. validate the intent structure
2. resolve goal references from the world model
3. map structural nodes into BT.CPP control/decorator nodes
4. map operation nodes into Nav2 / BT.CPP executable nodes
5. generate XML
6. generate blackboard initialization
7. produce a launchable run package

---

## 15. Why this exists

This language gives us the middle ground between:
- hardcoded templates
- and unconstrained raw XML generation

It keeps the model flexible while keeping execution safe and buildable.

### The model can
- compose
- sequence
- add fallbacks
- add repetition
- bind parameters

### The model cannot
- invent unsupported runtime primitives
- write arbitrary XML
- bypass validation
- create invisible execution semantics

---

## 16. Short version

The intent composition language is:
- a small constrained tree/list language
- used by the LLM skill to compose behavior
- validated by AutoM8te
- compiled into Nav2 / BT.CPP execution

It is the correct product surface for the new intent layer.
