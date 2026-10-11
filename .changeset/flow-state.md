---
"@patterkit/model": minor
"@patterkit/ops": patch
---

- `@patterkit/model`: `FlowState`, one flow taken out of a game as plain data (its `FlowSnapshot`, a `version`, and its own property values), and `FlowValues`, those values in a version 2 save's per-flow spelling (`scopes` and `sceneBags`). `FlowSnapshotV2` is now `FlowSnapshot` plus `FlowValues`, the same shape as before.

- `@patterkit/ops`: the runtime inlined in playable HTML exports is refreshed to this one.
