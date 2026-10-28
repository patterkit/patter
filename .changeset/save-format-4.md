---
"@patterkit/model": minor
"@patterkit/ops": minor
---

Save format 4, for 1.0 (the hands-on review of October 2026). **Breaking:** a saved pending choice keeps its options' ids, not their text, so it shows in the current language; a flow's cursor saves the next beat's id (`beatId`) instead of its index, and a frame inside a choice's option its choice's id (`choiceId`), so a save loads into a patched build. `SAVE_VERSION` is 4; the model keeps the version 3 shape (`SaveGameV3`) for loading, and drops the version 2 shapes (`SaveGameV2`, `FlowSnapshotV2`). Coverage drops a saved driver value that no longer fits its declaration, and skips a write the engine refuses, rather than failing the run.
