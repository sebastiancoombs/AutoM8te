# Zenoh State Direction

## Locked Direction

AutoM8te will use the following state flow as the architectural direction:

```text
Backend source of truth
(Unreal / Nav2 / real robots)
    ↓
State translators
(backend-native state → normalized shared state)
    ↓
Zenoh shared state fabric
    ↓
AutoM8te / LLM orchestration layer
    ↓
Composer intent
    ↓
Backend adapter / execution submission
    ↓
Backend-native behavior system
```

## Key rule
AutoM8te should **not** invent or own the authoritative world state.
The authoritative state lives in the active backend.

AutoM8te should:
- consume shared state from Zenoh
- reason over that state
- compose intent from that state
- route execution back into backend-native behavior systems

## What state translators do
State translators are responsible for:
- reading backend-native truth
- normalizing it into the shared state representation
- publishing that state into Zenoh

Examples:
- Unreal translator
- Nav2 translator
- future real robot translator

## What Zenoh does
Zenoh is the shared live state fabric.
It is the place where:
- backend truth is published
- distributed components can subscribe/query
- AutoM8te and future edge contributors can consume the same live state

## Why this is locked in
This keeps the architecture aligned with the digital twin model:
- backend remains source of truth
- orchestration remains backend-agnostic
- simulation and reality become two embodiments of the same system
- AutoM8te does not become a custom world-state platform
