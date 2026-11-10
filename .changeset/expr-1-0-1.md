---
"@patterkit/core": patch
"@patterkit/compiler": patch
"@patterkit/model": patch
"@patterkit/dialect": patch
"@patterkit/ops": patch
---

Uses `@wildwinter/expr` 1.0.1, where `+` on two strings is an error at play as it already was at compile: text built from pieces can't be translated.
