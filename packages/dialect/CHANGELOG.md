# @patterkit/dialect

## 0.1.7

### Patch Changes

- 2a16584: Move to @wildwinter/expr 0.5.0 and the new @wildwinter/toolkit.

  Opaque ids, the FNV-1a hash, JSON5 source parsing, the find/replace matcher and
  the archive guards now come from @wildwinter/toolkit instead of being
  maintained here and, separately, in the Storylet Engine. No behaviour change:
  the implementations moved, they were not rewritten.

- Updated dependencies [2a16584]
  - @patterkit/model@0.4.1

## 0.1.6

### Patch Changes

- f97f6eb: The `quality` property type (from @wildwinter/expr 0.4.0): a story stage as an ORDERED ladder of named
  stages. Declarations carry `stages`; ordering operators compare by ladder position; `advance()` steps
  to the next stage, saturating at the last; a stage name off the ladder is a compile-time error, and a
  quality with fewer than two stages or duplicate stage names is an invalid declaration. Saves carry the
  stage NAME, so inserting a stage mid-production shifts nothing. Coverage proposals random-walk a
  quality's stages, and the play-helpers state inspector edits one as a dropdown of its ladder.
- Updated dependencies [f97f6eb]
  - @patterkit/model@0.4.0

## 0.1.5

### Patch Changes

- Updated dependencies [614eaa8]
  - @patterkit/model@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [b14eadf]
  - @patterkit/model@0.2.1

## 0.1.3

### Patch Changes

- Updated dependencies [34429f0]
- Updated dependencies [34429f0]
- Updated dependencies [c61c146]
  - @patterkit/model@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [65f6ccb]
  - @patterkit/model@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [00bc37f]
  - @patterkit/model@0.1.1
