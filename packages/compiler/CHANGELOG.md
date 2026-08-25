# @patterkit/compiler

## 0.2.4

### Patch Changes

- f97f6eb: The `quality` property type (from @wildwinter/expr 0.4.0): a story stage as an ORDERED ladder of named
  stages. Declarations carry `stages`; ordering operators compare by ladder position; `advance()` steps
  to the next stage, saturating at the last; a stage name off the ladder is a compile-time error, and a
  quality with fewer than two stages or duplicate stage names is an invalid declaration. Saves carry the
  stage NAME, so inserting a stage mid-production shifts nothing. Coverage proposals random-walk a
  quality's stages, and the play-helpers state inspector edits one as a dropdown of its ladder.
- Updated dependencies [f97f6eb]
  - @patterkit/model@0.4.0
  - @patterkit/core@0.2.1
  - @patterkit/dialect@0.1.6

## 0.2.3

### Patch Changes

- Updated dependencies [614eaa8]
  - @patterkit/core@0.2.0
  - @patterkit/model@0.3.0
  - @patterkit/dialect@0.1.5

## 0.2.2

### Patch Changes

- Updated dependencies [b14eadf]
  - @patterkit/model@0.2.1
  - @patterkit/core@0.1.5
  - @patterkit/dialect@0.1.4

## 0.2.1

### Patch Changes

- Updated dependencies [178967e]
  - @patterkit/core@0.1.4

## 0.2.0

### Minor Changes

- 34429f0: Stop shipping the voice actor's name in the compiled bundle. `CastMember.actor` was documented as authoring-only but `exportBundle` only stripped `notes`, so every `.patterc` carried the real name of every actor cast. The compiler now copies the cast across field by field (an allow-list: `name`, `displayName`, `gameData`), so `actor`, `notes` and `gender` stay out, and a field added to `CastMember` later cannot start shipping by accident. The new `BundleCastMember` type states the contract for anyone reading a bundle. Note that this changes bundle content for any project that names actors, so `content.hash` / `structureHash` shift and old saves may be gated as stale.

### Patch Changes

- 34429f0: Add `CastMember.gender` (a new `GrammaticalGender` type: `male` / `female` / `neuter`, absent = not specified) and carry it into the localisation handoff as translator context, so gendered languages can inflect a character's own lines: a `Gender` column in the Excel export, a `#. Gender: <g>` extracted comment in PO/POT, and `context.gender` on each JSON `LocEntry`. It is export-only (regenerated from the cast each export, never read back by `applyLoc`) and the compiler strips it from the runtime bundle alongside `notes`.
- Updated dependencies [34429f0]
- Updated dependencies [34429f0]
- Updated dependencies [c61c146]
  - @patterkit/model@0.2.0
  - @patterkit/core@0.1.3
  - @patterkit/dialect@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [65f6ccb]
  - @patterkit/model@0.1.2
  - @patterkit/core@0.1.2
  - @patterkit/dialect@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [00bc37f]
  - @patterkit/model@0.1.1
  - @patterkit/core@0.1.1
  - @patterkit/dialect@0.1.1
