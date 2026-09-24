---
"@patterkit/model": minor
"@patterkit/play-helpers": minor
"@patterkit/ops": patch
---

One registry per game. `SaveGame` is version 3 (`SAVE_VERSION`): it holds what is not a property, plus the engine's own registry's values under an optional `registry`, and the version 2 shape is kept as `SaveGameV2` / `FlowSnapshotV2` for readers. Registry keys for Patter's bags are documented beside the types.

`@patterkit/play-helpers`: `snapshotState` reads the engine's bags directly rather than the save, so it keeps working now that a save carries no property values when the game owns the registry. Its path space is unchanged.

`@patterkit/ops` carries the inlined runtime for playable-HTML exports, so its copy moves with the runtime.
