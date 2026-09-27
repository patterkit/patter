---
"@patterkit/dialect": patch
"@patterkit/compiler": patch
"@patterkit/play-helpers": patch
"@patterkit/ops": patch
---

Accept any `@wildwinter/scoperegistry` from 0.8.0 up to 1.0, so an install keeps one copy of the registry that a game and every engine share, and a later registry release cannot split it into two. `@patterkit/play-helpers` and `@patterkit/ops` also move to `@patterkit/runtime` 0.14.1, which accepts the same range; with 0.14.0 an install held two copies.
