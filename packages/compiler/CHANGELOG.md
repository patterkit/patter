# @patterkit/compiler

## 0.13.0

### Minor Changes

- 105884d: Patter extensions can declare a `pick` field (`@wildwinter/toolkit` 0.2.5): one choice from fixed words, the nodes of a reference kind such as the cast, and lists of text on the extension's own project node. The compiler checks each value against them, from the extension's project entry wherever its shard sits: a value no source holds is an error (`not-a-choice`), one two sources hold a warning (`pick-ambiguous`), and each name two sources hold is reported once for the project (`pick-clash`), so `patter validate` catches a misspelt name. A cast rename rewrites the pick values naming the member (`renameCastKeys`), as it rewrites references; a renamed entry of a project list isn't followed, so a value naming the old entry is reported missing.

### Patch Changes

- 35964cc: Version-control setup and `patter mergetool` now come from `@wildwinter/toolkit` 0.2.3's shared `vcs` module, the same copy Storylets uses. Every pattern, attribute, and command in the generated files is unchanged; their wording is tidied and their rows are column-aligned. `mergetool` keeps its order and exit codes.
- Updated dependencies [105884d]
- Updated dependencies [35964cc]
  - @patterkit/core@0.9.4

## 0.12.0

### Minor Changes

- b1e5e0b: A host scope's declarations (`@world`) ship in the bundle with their defaults resolved, as every other declaration's are. Nothing plays differently: a bound resolver still supplies the game's values, and the default is only the fallback the runtime self-backs with.

### Patch Changes

- Updated dependencies [b1e5e0b]
- Updated dependencies [0e0708a]
  - @patterkit/core@0.9.3
  - @patterkit/model@0.19.0
  - @patterkit/dialect@0.2.16

## 0.11.0

### Minor Changes

- f5775c7: `exportBundle` compiles a dialogue scene's text beats as action when the project doesn't localise them (`localiseDialogueText` off, the default): `action: true` on the beat, and its source text in every locale's string table, whatever a translated shard still holds. An option's prompt never is. **This changes existing projects:** a localised project that shows its dialogue scenes' text to players should turn `localiseDialogueText` on, which compiles exactly as before. A hand-written `action` key in source never reaches the bundle.

### Patch Changes

- Updated dependencies [f5775c7]
  - @patterkit/model@0.18.0
  - @patterkit/core@0.9.2
  - @patterkit/dialect@0.2.15

## 0.10.0

### Minor Changes

- e6aa49e: `exportBundle` writes each Patter extension's settings into the bundle's `extensions` section (`settings`, keys sorted): every setting the manifest declares, with the project's value or else the setting's default, as `@wildwinter/toolkit/extensions`' `settingValues` resolves it. They're in the content hashes with the rest of the section. A project with no extensions compiles byte for byte as before.

### Patch Changes

- e6aa49e: A Patter extension's claim may leave out an enum's or flags' `values`, or a quality's `stages` (`@wildwinter/toolkit` 0.2.1): the project's gameData field is then the vocabulary. The extension pass checks a claimed field's values against the claim over the project's declaration (`effectiveClaim`), so a value the field declares passes and one it doesn't is an error, and the claim's value help may describe values the field doesn't declare. A claim on a field declared with another type is still an error, and one on a field the project doesn't declare still a warning. Depends on `@wildwinter/toolkit` ^0.2.1.
- Updated dependencies [e6aa49e]
- Updated dependencies [e6aa49e]
  - @patterkit/core@0.9.1
  - @patterkit/model@0.17.0
  - @patterkit/dialect@0.2.14

## 0.9.0

### Minor Changes

- 247a652: The compiler compiles Patter extensions. `extensionPass` is the one manifest-driven pass over a project's extension files: the manifests' own problems, a manifest or shard named for another extension, an extension the project takes with no manifest (a warning, its data left untouched) or at another version, its settings, claims on the project's gameData fields (one the project doesn't declare is a warning, one it declares with another type an error, and every value a claimed field holds is checked against the claim), entries naming a node the project no longer has (a warning each), an entry in another scene's shard (a warning, compiled all the same), and every value against the extension's declarations, references to cast members included. `extensionNodes` lists every node an extension can attach to. `exportBundle` takes the files as `extensions` and compiles each node's values inline under `extensions` (editor-only fields left out, renamed stages renamed, an entry with an error left out) and each extension's declarations, every default resolved, in the bundle's `extensions` section; both are in the content hashes. A project with no extensions compiles byte for byte as before. Depends on `@wildwinter/toolkit` 0.2.0.

### Patch Changes

- Updated dependencies [54fb3be]
- Updated dependencies [54fb3be]
- Updated dependencies [247a652]
- Updated dependencies [247a652]
  - @patterkit/core@0.9.0
  - @patterkit/model@0.16.0
  - @patterkit/dialect@0.2.13

## 0.8.0

### Minor Changes

- f3e1277: Defaults are optional in source and resolved in the bundle (the family's rule, ruled 2026-10-18): every property, scene property and game-data field in the bundle carries its default, the one it was given or else its type's by `defaultFor`. The content hashes stay over the source as written, and a host scope's declarations ship as written. A set effect assigning a quality is checked with `validateAssignment`: a stage it names must be one of that quality's.

### Patch Changes

- Updated dependencies [f3e1277]
- Updated dependencies [f3e1277]
- Updated dependencies [f3e1277]
  - @patterkit/core@0.8.0
  - @patterkit/dialect@0.2.12
  - @patterkit/model@0.15.0

## 0.7.1

### Patch Changes

- Updated dependencies [6c7eb79]
  - @patterkit/core@0.7.1

## 0.7.0

### Minor Changes

- 1a3f2db: Speaker labels: how a game shows a qualified speaker's name.

  - `@patterkit/model`: `CastMember.qualifierLabels` (a character's own label with a qualifier, by the qualifier's Game ID), `ProjectFile.speakerPattern` and `Bundle.speakerPattern` (`{name} ({qualifier})` by default), `SavedChoicePrompt.speakerLabel`, and the helpers `speakerLabelKey`, `SPEAKER_PATTERN_KEY`, `DEFAULT_SPEAKER_PATTERN`, `formatSpeakerLabel`, and `usedSpeakerPairs`.
  - `@patterkit/core`: `validateProject` reports a speaker pattern or a character's labels that aren't text (`invalid-speaker-label`), and warns on a character's own label for a pair no line uses (`unused-speaker-label`).
  - `@patterkit/compiler`: the bundle carries the project's speaker pattern when it isn't the default, and each character's own labels for the pairs the lines use.
  - `@patterkit/ops`: localisation exports carry the speaker pattern (`speaker:pattern`, with a note for translators) when the lines use a qualifier, and a `speaker:<NAME>:<qualifier>` string for each pair the writer gave a label of its own; both read back on import. The playable HTML shows the step's speaker label. A project merge merges cast members field by field, and a character's labels pair by pair, so two branches that each change a different field, or each add a label, both land.
  - `@patterkit/ops`: `projectStringSources(project, sourceTable)` gives the source text of every project-level string (display names, qualifier names, the speaker pattern, and pair labels), the one rule the localisation export and an editor's stale tracking share; `authoringPath` is exported beside it.

### Patch Changes

- Updated dependencies [1a3f2db]
  - @patterkit/model@0.14.0
  - @patterkit/core@0.7.0
  - @patterkit/dialect@0.2.11

## 0.6.2

### Patch Changes

- db35050: Each package now carries the MIT licence text (LICENSE) in its own folder, so the licence travels with every install.
- Updated dependencies [db35050]
  - @patterkit/model@0.13.1
  - @patterkit/core@0.6.2
  - @patterkit/dialect@0.2.10

## 0.6.1

### Patch Changes

- Updated dependencies [b3ecb18]
  - @patterkit/model@0.13.0
  - @patterkit/core@0.6.1
  - @patterkit/dialect@0.2.9

## 0.6.0

### Minor Changes

- 09f4abc: Line padding: the pause after a line, a writing decision every tool now times the same way.

  - `@patterkit/model`: `padAfter` on line and text beats, in seconds (negative cuts the next line in on this one); `padAfterDefault` on snippets, groups, blocks, scenes, the project, and the bundle; `DEFAULT_PAD_AFTER` (0.6), `PAD_AFTER_MIN` and `PAD_AFTER_MAX`.
  - `@patterkit/core`: `validateProject` reports a pause outside the range (`invalid-pad`), and warns on a negative pause on a snippet's last line, which can't cut in across the seam (`pad-overlaps-seam`).
  - `@patterkit/compiler`: the bundle carries the defaults, and the project's when it sets one, folded into its hashes; a project that sets none compiles exactly as before.

### Patch Changes

- Updated dependencies [09f4abc]
- Updated dependencies [9630c0e]
  - @patterkit/model@0.12.0
  - @patterkit/core@0.6.0
  - @patterkit/dialect@0.2.8

## 0.5.0

### Minor Changes

- a4db109: Speaker qualifiers: a line can say how it is delivered, a screenplay's `TAM (O.S.)`, without becoming a second character.

  - `@patterkit/model`: `LineBeat.qualifier` (the qualifier's `gameId`), `ProjectFile.qualifiers` with `DEFAULT_QUALIFIERS` (`V.O.`, `O.S.`, `RADIO`), `projectQualifiers`, `usedQualifiers`, `qualifierStringKey`, `Bundle.qualifiers`, the qualifier on a saved choice prompt, and qualifier slots on handoff lines and suggestions.
  - `@patterkit/core`: `validateProject` reports a line whose qualifier isn't in the project's list (`unknown-qualifier`) and a malformed list (`invalid-qualifier`).
  - `@patterkit/compiler`: the bundle carries the qualifiers the lines use, and folds them into its hashes; a project that uses none compiles exactly as before.

### Patch Changes

- Updated dependencies [a4db109]
  - @patterkit/model@0.11.0
  - @patterkit/core@0.5.0
  - @patterkit/dialect@0.2.7

## 0.4.7

### Patch Changes

- Updated dependencies [b4a4a39]
  - @patterkit/core@0.4.1

## 0.4.6

### Patch Changes

- 873585e: `validateInterpolation` looks each string up once per language rather than once per shard: 5 ms rather than 182 ms on a 100-scene project.
- Updated dependencies [873585e]
- Updated dependencies [caaf755]
  - @patterkit/core@0.4.0
  - @patterkit/model@0.10.0
  - @patterkit/dialect@0.2.6

## 0.4.5

### Patch Changes

- Updated dependencies [5ac9fb2]
  - @patterkit/model@0.9.0
  - @patterkit/core@0.3.2
  - @patterkit/dialect@0.2.5

## 0.4.4

### Patch Changes

- Updated dependencies [6da8b0c]
  - @patterkit/model@0.8.0
  - @patterkit/core@0.3.1
  - @patterkit/dialect@0.2.4

## 0.4.3

### Patch Changes

- dc7ff54: `@wildwinter/scoperegistry` is now a peer dependency, as it is of `@patterkit/runtime`: a game and every engine in it share one registry, so an install must hold exactly one copy. npm installs it for you; if two packages ever need versions that cannot be one copy, the install stops and says so instead of adding a second.
- Updated dependencies [dc7ff54]
  - @patterkit/dialect@0.2.3

## 0.4.2

### Patch Changes

- ba3d8ec: Accept any `@wildwinter/scoperegistry` from 0.8.0 up to 1.0, so an install keeps one copy of the registry that a game and every engine share, and a later registry release cannot split it into two. `@patterkit/play-helpers` and `@patterkit/ops` also move to `@patterkit/runtime` 0.14.1, which accepts the same range; with 0.14.0 an install held two copies.
- Updated dependencies [ba3d8ec]
  - @patterkit/dialect@0.2.2

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
