---
"@patterkit/compiler": patch
"@patterkit/dialect": patch
"@patterkit/play-helpers": patch
"@patterkit/ops": patch
---

Requires `@wildwinter/scoperegistry` ^0.6.0, whose `set` now takes an explicit host authority. A host-scope declaration's `writable: false` is the STORY's promise not to write the value, and only the story's: the game writes it through `Engine.setProperty` / `Flow.setProperty` whether the property is self-backed or bound to a resolver. The story's effects are refused exactly as before. This unblocks any host tooling that drives a read-only `@world` property, Patterplay's coverage drivers included.

`@patterkit/ops` carries the inlined runtime for playable-HTML exports, so its copy moves with the runtime.
