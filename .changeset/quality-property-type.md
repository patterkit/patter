---
"@patterkit/model": minor
"@patterkit/core": patch
"@patterkit/dialect": patch
"@patterkit/compiler": patch
"@patterkit/ops": patch
"@patterkit/play-helpers": patch
---

The `quality` property type (from @wildwinter/expr 0.4.0): a story stage as an ORDERED ladder of named
stages. Declarations carry `stages`; ordering operators compare by ladder position; `advance()` steps
to the next stage, saturating at the last; a stage name off the ladder is a compile-time error, and a
quality with fewer than two stages or duplicate stage names is an invalid declaration. Saves carry the
stage NAME, so inserting a stage mid-production shifts nothing. Coverage proposals random-walk a
quality's stages, and the play-helpers state inspector edits one as a dropdown of its ladder.
