---
"@patterkit/ops": minor
---

`@patterkit/ops`: `planPins(loaded)`, pin on publish. It plans writing down every scene and block Game ID that still follows its name, at the address it already has, and returns what it pinned, the flow-shard writes, and the rewritten scenes for an editor's in-memory copy. Patterpad's Publish Bundle calls it; nothing else does, the CLI's `export` included, because a build in CI must never write source.
