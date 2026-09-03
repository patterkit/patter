---
"@patterkit/model": minor
"@patterkit/play-helpers": patch
"@patterkit/ops": patch
---

The save format is now the family's contract, owned by `@patterkit/model`.

`SaveEnvelope`, `SaveGame`, `FlowSnapshot`, `FlowCursor` and the rest of the `patter/save@0` shape are exported from the model (with `SAVE_SCHEMA`), and re-exported from `@patterkit/runtime` and `@patterkit/play-helpers` so existing imports keep working. Nothing the JS runtime writes has changed: its output was always this shape. What changed is that the three native ports now write and read it too, so a save crosses engines, and the conformance corpus carries a save the JS reference wrote that every runtime must load, write back with the same key paths, and continue.

`@patterkit/ops` ships a fresh snapshot of the playable runtime, so an exported HTML script writes this shape too.
