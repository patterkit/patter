---
"@patterkit/compiler": patch
"@patterkit/cli": patch
"@patterkit/core": patch
"@patterkit/ops": patch
---

An extension's manifest can say which other extensions it requires (`requires`, with `@wildwinter/toolkit` 0.3.1). The extension pass, and so `patter validate`, warns of a project that takes an extension without one it requires (`requires-missing`), naming what to add. A field of an extension can name one of its views as its `editor`, which the toolkit checks.
