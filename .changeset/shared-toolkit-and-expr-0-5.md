---
"@patterkit/core": patch
"@patterkit/model": patch
"@patterkit/compiler": patch
"@patterkit/dialect": patch
"@patterkit/play-helpers": patch
---

Move to @wildwinter/expr 0.5.0 and the new @wildwinter/toolkit.

Opaque ids, the FNV-1a hash, JSON5 source parsing, the find/replace matcher and
the archive guards now come from @wildwinter/toolkit instead of being
maintained here and, separately, in the Storylet Engine. No behaviour change:
the implementations moved, they were not rewritten.
