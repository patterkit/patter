# @patterkit/compiler

## 0.4.1

### Patch Changes

- Updated dependencies [2984ec6]
  - @patterkit/core@0.3.0

## 0.4.0

### Minor Changes

- 40befdb: Shared game scopes (requires `@wildwinter/scoperegistry` ^0.8.0). A game can keep one `game-scopes/` folder where each editing tool writes the properties it declares and reads the others'.

  `@patterkit/model`: `ProjectFile.gameScopes`, a path (relative to the project file) naming the folder when the walk-up from the project would not find it.

  `@patterkit/compiler`: `validateConditions` and `validateInterpolation` take `gameScopes` (the merged folder) and check every scope in it the host spec doesn't hold, with warnings only: an undeclared name (worded by `referenceNote`), a type mismatch, or a write to a read-only property. `exportBundle` takes `gameScopes` too: `game.scopes.json` wins over the project's copy of a host scope, its `@world` is baked into `scopeRegistry` even when the project doesn't declare it, and every other scope in the folder compiles as another engine's does, named in `externalScopes` and never baked in. New exports: `projectScopes`, `externalGameScopes`, `PATTER_SCOPE`, and `EXTERNAL_SCOPES` (re-exported from the dialect).

  `@patterkit/ops`: the loaders discover the folder (`LoadedProject.gameScopes`, `gameScopesMissing`), and export, validate, play, coverage, and reachability pass it on. `runValidate` gains `gameScopes` issues (a file that won't parse, a token two files claim, and a missing override are errors; `patter.scopes.json` out of date and the project's copy of a game scope differing are warnings), and `ok` now counts only errors among condition and interpolation issues. `runPlay` and coverage stand other engines in from the folder (`previewRegistry`) when the bundle names them. New helpers for editors: `patterScopesFile`, `patterScopesWrite`, `planWorldSave`, `planShareScopes`, `worldSettingsScopes`, `defaultGameScopesDir`, `gameScopesCatalogue`, `gameScopeTokens`.

  `@patterkit/cli`: `export` writes `game-scopes/patter.scopes.json` when there is a folder and the file would change; `validate` prints the folder's issues as `[game-scopes]`, and prints warnings as such without failing; `play` and `coverage` run content naming another engine's scope where the folder declares it.

### Patch Changes

- Updated dependencies [40befdb]
- Updated dependencies [40befdb]
  - @patterkit/dialect@0.2.1
  - @patterkit/model@0.7.0
  - @patterkit/core@0.2.6

## 0.3.0

### Minor Changes

- 7f3db84: Other engines' scopes, with no setting. `@patterkit/dialect` accepts every game-wide scope token in the family's shared list other than Patter's own (`@story`), opaque, and exports `ENGINE_SCOPES`, `EXTERNAL_SCOPES`, and `withEngineScopes`. The compiler and its validators let those tokens through, record the ones the content names in `Bundle.externalScopes`, and never list them in the bundle's `scopeRegistry`, so the runtime does not self-back them.

### Patch Changes

- Updated dependencies [b91b7e1]
- Updated dependencies [7f3db84]
  - @patterkit/model@0.6.0
  - @patterkit/dialect@0.2.0
  - @patterkit/core@0.2.5

## 0.2.8

### Patch Changes

- Updated dependencies [df4cd3a]
  - @patterkit/core@0.2.4

## 0.2.7

### Patch Changes

- 2e81c41: Requires `@wildwinter/scoperegistry` ^0.6.0, whose `set` now takes an explicit host authority. A host-scope declaration's `writable: false` is the STORY's promise not to write the value, and only the story's: the game writes it through `Engine.setProperty` / `Flow.setProperty` whether the property is self-backed or bound to a resolver. The story's effects are refused exactly as before. This unblocks any host tooling that drives a read-only `@world` property, Patterplay's coverage drivers included.

  `@patterkit/ops` carries the inlined runtime for playable-HTML exports, so its copy moves with the runtime.

- Updated dependencies [2e81c41]
  - @patterkit/dialect@0.1.9

## 0.2.6

### Patch Changes

- Updated dependencies [44e9696]
  - @patterkit/model@0.5.0
  - @patterkit/core@0.2.3
  - @patterkit/dialect@0.1.8

## 0.2.5

### Patch Changes

- 2a16584: Move to @wildwinter/expr 0.5.0 and the new @wildwinter/toolkit.

  Opaque ids, the FNV-1a hash, JSON5 source parsing, the find/replace matcher and
  the archive guards now come from @wildwinter/toolkit instead of being
  maintained here and, separately, in the Storylet Engine. No behaviour change:
  the implementations moved, they were not rewritten.

- Updated dependencies [2a16584]
  - @patterkit/core@0.2.2
  - @patterkit/model@0.4.1
  - @patterkit/dialect@0.1.7

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
