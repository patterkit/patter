# @patterkit/model

## 0.17.0

### Minor Changes

- e6aa49e: `BundleExtension.settings`: the bundle carries each Patter extension's settings, every one its manifest declares, by setting name, with the project's value or else the setting's default. It's present only when the manifest declares settings, so a bundle whose extensions declare none is unchanged.

## 0.16.0

### Minor Changes

- 54fb3be: `GameDataNodeKind` gains `option`: a choice's option (a group that is a direct child of a `choice` group) declares game-data fields like any other node kind.
- 247a652: The model takes Patter extensions: `ProjectFile.extensions` (the extensions a project takes, each pinned to a version, with its settings), the extension data shard (`ExtensionShard`, `EXTENSION_SCHEMA`, `.patterextension`, kept under the new `layout.extensions`, `extensions/` by default), where manifests live (`EXTENSIONS_DIR`, `MANIFEST_EXTENSION`), and the reserved `unresolved` key a merge marks a shard with (`UNRESOLVED_KEY`). The bundle types gain `Bundle.extensions` and an `extensions` value on each beat and compiled node, absent until a project takes an extension, so every bundle today is exactly what it was. `projectLayout` returns the new `ProjectLayout`.

## 0.15.0

### Minor Changes

- f3e1277: Game data takes the family's field types, shared with Storylets' card and outcome fields: `GameDataFieldType` gains `flags` and `quality`, and `GameDataField` gains `stages`, a quality field's ladder in order. A field's `default` stays optional, and is now documented as resolved into the bundle.

## 0.14.0

### Minor Changes

- 1a3f2db: Speaker labels: how a game shows a qualified speaker's name.

  - `@patterkit/model`: `CastMember.qualifierLabels` (a character's own label with a qualifier, by the qualifier's Game ID), `ProjectFile.speakerPattern` and `Bundle.speakerPattern` (`{name} ({qualifier})` by default), `SavedChoicePrompt.speakerLabel`, and the helpers `speakerLabelKey`, `SPEAKER_PATTERN_KEY`, `DEFAULT_SPEAKER_PATTERN`, `formatSpeakerLabel`, and `usedSpeakerPairs`.
  - `@patterkit/core`: `validateProject` reports a speaker pattern or a character's labels that aren't text (`invalid-speaker-label`), and warns on a character's own label for a pair no line uses (`unused-speaker-label`).
  - `@patterkit/compiler`: the bundle carries the project's speaker pattern when it isn't the default, and each character's own labels for the pairs the lines use.
  - `@patterkit/ops`: localisation exports carry the speaker pattern (`speaker:pattern`, with a note for translators) when the lines use a qualifier, and a `speaker:<NAME>:<qualifier>` string for each pair the writer gave a label of its own; both read back on import. The playable HTML shows the step's speaker label. A project merge merges cast members field by field, and a character's labels pair by pair, so two branches that each change a different field, or each add a label, both land.
  - `@patterkit/ops`: `projectStringSources(project, sourceTable)` gives the source text of every project-level string (display names, qualifier names, the speaker pattern, and pair labels), the one rule the localisation export and an editor's stale tracking share; `authoringPath` is exported beside it.

## 0.13.1

### Patch Changes

- db35050: Each package now carries the MIT licence text (LICENSE) in its own folder, so the licence travels with every install.

## 0.13.0

### Minor Changes

- b3ecb18: - `@patterkit/model`: `FlowState`, one flow taken out of a game as plain data (its `FlowSnapshot`, a `version`, and its own property values), and `FlowValues`, those values in a version 2 save's per-flow spelling (`scopes` and `sceneBags`). `FlowSnapshotV2` is now `FlowSnapshot` plus `FlowValues`, the same shape as before.

  - `@patterkit/ops`: the runtime inlined in playable HTML exports is refreshed to this one.

## 0.12.0

### Minor Changes

- 09f4abc: Line padding: the pause after a line, a writing decision every tool now times the same way.

  - `@patterkit/model`: `padAfter` on line and text beats, in seconds (negative cuts the next line in on this one); `padAfterDefault` on snippets, groups, blocks, scenes, the project, and the bundle; `DEFAULT_PAD_AFTER` (0.6), `PAD_AFTER_MIN` and `PAD_AFTER_MAX`.
  - `@patterkit/core`: `validateProject` reports a pause outside the range (`invalid-pad`), and warns on a negative pause on a snippet's last line, which can't cut in across the seam (`pad-overlaps-seam`).
  - `@patterkit/compiler`: the bundle carries the defaults, and the project's when it sets one, folded into its hashes; a project that sets none compiles exactly as before.

### Patch Changes

- 9630c0e: Speaker qualifiers and line padding, tidied after review.

  - `@patterkit/model`: `HandoffLine.qualifierName`, the qualifier's name as the editable script's cue printed it. Optional, so older handoff records still load.
  - `@patterkit/core`: `validateProject` warns on a qualifier on a line with no speaker (`qualifier-without-speaker`), and on a negative pause on an option's prompt when the option plays no beat (`prompt-pad-without-beat`); it reports a qualifier list that isn't a list, or holds an entry that isn't a qualifier, as `invalid-qualifier` instead of throwing.
  - `@patterkit/ops`: reimporting an editable script reads each cue against the qualifier name it was printed with, so renaming a qualifier in settings after export no longer reads an untouched cue as a change. The project merge merges `qualifiers` per `gameId`, so two branches each adding one both land.

## 0.11.0

### Minor Changes

- a4db109: Speaker qualifiers: a line can say how it is delivered, a screenplay's `TAM (O.S.)`, without becoming a second character.

  - `@patterkit/model`: `LineBeat.qualifier` (the qualifier's `gameId`), `ProjectFile.qualifiers` with `DEFAULT_QUALIFIERS` (`V.O.`, `O.S.`, `RADIO`), `projectQualifiers`, `usedQualifiers`, `qualifierStringKey`, `Bundle.qualifiers`, the qualifier on a saved choice prompt, and qualifier slots on handoff lines and suggestions.
  - `@patterkit/core`: `validateProject` reports a line whose qualifier isn't in the project's list (`unknown-qualifier`) and a malformed list (`invalid-qualifier`).
  - `@patterkit/compiler`: the bundle carries the qualifiers the lines use, and folds them into its hashes; a project that uses none compiles exactly as before.

## 0.10.0

### Minor Changes

- caaf755: The doc comment on `export.bundle` gives the new default, `../patter-dist/<name>.patterc` beside the project. New `DEFAULT_LAYOUT` and `projectLayout(project)`, the one statement of where a project keeps its shards, and the source schema tags as constants (`FLOW_SCHEMA`, `PROJECT_SCHEMA`, `STRINGS_SCHEMA`, `AUTHORING_SCHEMA`).

## 0.9.0

### Minor Changes

- 5ac9fb2: The save shape gains an optional `FlowCursor.pendingPrompt`: the prompt `replayPromptOnChoose` is still to speak back, as the choice showed it. The runtime inlined into playable HTML exports is refreshed to the current engine (only an authored prompt is replayed, exactly as shown).

## 0.8.0

### Minor Changes

- 6da8b0c: Groundwork for the editable script handoff, all additive:

  - A `Suggestion` can now also propose a new speaker (`proposedCharacter`), a new direction (`proposedDirection`), or cutting the beat (`proposedCut`), each with its own baseline for the staleness check. It can credit several people (`authors`, with `author` staying the primary), and record the handoff it arrived in (`handoff`).
  - New `HandoffFile` record (schema `patter/handoff@0`, exported as `HANDOFF_SCHEMA`), with `HandoffLine`, `HandoffRow`, and `HandoffImport`.
  - `DEFAULT_DOCUMENTATION_CLASSES` gains `editor`, delivered to the `editor` channel: notes meant for an outside editor.

## 0.7.0

### Minor Changes

- 40befdb: Shared game scopes (requires `@wildwinter/scoperegistry` ^0.8.0). A game can keep one `game-scopes/` folder where each editing tool writes the properties it declares and reads the others'.

  `@patterkit/model`: `ProjectFile.gameScopes`, a path (relative to the project file) naming the folder when the walk-up from the project would not find it.

  `@patterkit/compiler`: `validateConditions` and `validateInterpolation` take `gameScopes` (the merged folder) and check every scope in it the host spec doesn't hold, with warnings only: an undeclared name (worded by `referenceNote`), a type mismatch, or a write to a read-only property. `exportBundle` takes `gameScopes` too: `game.scopes.json` wins over the project's copy of a host scope, its `@world` is baked into `scopeRegistry` even when the project doesn't declare it, and every other scope in the folder compiles as another engine's does, named in `externalScopes` and never baked in. New exports: `projectScopes`, `externalGameScopes`, `PATTER_SCOPE`, and `EXTERNAL_SCOPES` (re-exported from the dialect).

  `@patterkit/ops`: the loaders discover the folder (`LoadedProject.gameScopes`, `gameScopesMissing`), and export, validate, play, coverage, and reachability pass it on. `runValidate` gains `gameScopes` issues (a file that won't parse, a token two files claim, and a missing override are errors; `patter.scopes.json` out of date and the project's copy of a game scope differing are warnings), and `ok` now counts only errors among condition and interpolation issues. `runPlay` and coverage stand other engines in from the folder (`previewRegistry`) when the bundle names them. New helpers for editors: `patterScopesFile`, `patterScopesWrite`, `planWorldSave`, `planShareScopes`, `worldSettingsScopes`, `defaultGameScopesDir`, `gameScopesCatalogue`, `gameScopeTokens`.

  `@patterkit/cli`: `export` writes `game-scopes/patter.scopes.json` when there is a folder and the file would change; `validate` prints the folder's issues as `[game-scopes]`, and prints warnings as such without failing; `play` and `coverage` run content naming another engine's scope where the folder declares it.

## 0.6.0

### Minor Changes

- b91b7e1: One registry per game. `SaveGame` is version 3 (`SAVE_VERSION`): it holds what is not a property, plus the engine's own registry's values under an optional `registry`, and the version 2 shape is kept as `SaveGameV2` / `FlowSnapshotV2` for readers. Registry keys for Patter's bags are documented beside the types.

  `@patterkit/play-helpers`: `snapshotState` reads the engine's bags directly rather than the save, so it keeps working now that a save carries no property values when the game owns the registry. Its path space is unchanged.

  `@patterkit/ops` carries the inlined runtime for playable-HTML exports, so its copy moves with the runtime.

- 7f3db84: Other engines' scopes, with no setting. `@patterkit/dialect` accepts every game-wide scope token in the family's shared list other than Patter's own (`@story`), opaque, and exports `ENGINE_SCOPES`, `EXTERNAL_SCOPES`, and `withEngineScopes`. The compiler and its validators let those tokens through, record the ones the content names in `Bundle.externalScopes`, and never list them in the bundle's `scopeRegistry`, so the runtime does not self-back them.

## 0.5.0

### Minor Changes

- 44e9696: The save format is now the family's contract, owned by `@patterkit/model`.

  `SaveEnvelope`, `SaveGame`, `FlowSnapshot`, `FlowCursor` and the rest of the `patter/save@0` shape are exported from the model (with `SAVE_SCHEMA`), and re-exported from `@patterkit/runtime` and `@patterkit/play-helpers` so existing imports keep working. Nothing the JS runtime writes has changed: its output was always this shape. What changed is that the three native ports now write and read it too, so a save crosses engines, and the conformance corpus carries a save the JS reference wrote that every runtime must load, write back with the same key paths, and continue.

  `@patterkit/ops` ships a fresh snapshot of the playable runtime, so an exported HTML script writes this shape too.

## 0.4.1

### Patch Changes

- 2a16584: Move to @wildwinter/expr 0.5.0 and the new @wildwinter/toolkit.

  Opaque ids, the FNV-1a hash, JSON5 source parsing, the find/replace matcher and
  the archive guards now come from @wildwinter/toolkit instead of being
  maintained here and, separately, in the Storylet Engine. No behaviour change:
  the implementations moved, they were not rewritten.

## 0.4.0

### Minor Changes

- f97f6eb: The `quality` property type (from @wildwinter/expr 0.4.0): a story stage as an ORDERED ladder of named
  stages. Declarations carry `stages`; ordering operators compare by ladder position; `advance()` steps
  to the next stage, saturating at the last; a stage name off the ladder is a compile-time error, and a
  quality with fewer than two stages or duplicate stage names is an invalid declaration. Saves carry the
  stage NAME, so inserting a stage mid-production shifts nothing. Coverage proposals random-walk a
  quality's stages, and the play-helpers state inspector edits one as a dropdown of its ladder.

## 0.3.0

### Minor Changes

- 614eaa8: Property names are held to the grammar of the expression language that resolves them.

  `@wildwinter/expr` lexes an identifier as `/[a-zA-Z_][a-zA-Z0-9_]*/` and folds it to
  lower case, so `isNight` is a declaration nothing can reach, `9lives` and `not` will
  not parse, and `is-night` is worse than either: it compiles to `@scope.is` MINUS the
  string `night`, quietly meaning something else. `@patterkit/model` now exports
  `propertyNameify`, `isValidPropertyName`, `isCaseOnlyPropertyName` and
  `RESERVED_PROPERTY_NAMES`; `validateProject` reports `invalid-declaration` for a name
  that breaks the rule, in all three places one can be declared (`@patter` globals,
  `@scene` props, host-scope declarations), naming what would actually happen and
  offering the coerced name.

  Existing projects keep working: `loadProject` folds a name that is legal apart from
  its case, since every reference was folded already and nothing observable changes. A
  name that needs more than folding is left alone and reported, rather than guessed at.

  The same rules ship as the defaults in `@wildwinter/app-shell` 0.29.0, and Storyletter
  holds the same pair, so a property name means one thing across both families.

## 0.2.1

### Patch Changes

- b14eadf: `GrammaticalGender` is now `string` (was the closed union `"male" | "female" | "neuter"`), because three genders don't cover every language (common/utrum, animate/inanimate, and so on). A new exported `COMMON_GENDERS` lists the everyday values for editors to offer as auto-suggest defaults. The value is still authoring-only translator context, dropped from the compiled bundle; every export format already carried it as an opaque string, so nothing downstream changes.

## 0.2.0

### Minor Changes

- 34429f0: Stop shipping the voice actor's name in the compiled bundle. `CastMember.actor` was documented as authoring-only but `exportBundle` only stripped `notes`, so every `.patterc` carried the real name of every actor cast. The compiler now copies the cast across field by field (an allow-list: `name`, `displayName`, `gameData`), so `actor`, `notes` and `gender` stay out, and a field added to `CastMember` later cannot start shipping by accident. The new `BundleCastMember` type states the contract for anyone reading a bundle. Note that this changes bundle content for any project that names actors, so `content.hash` / `structureHash` shift and old saves may be gated as stale.
- 34429f0: Add `CastMember.gender` (a new `GrammaticalGender` type: `male` / `female` / `neuter`, absent = not specified) and carry it into the localisation handoff as translator context, so gendered languages can inflect a character's own lines: a `Gender` column in the Excel export, a `#. Gender: <g>` extracted comment in PO/POT, and `context.gender` on each JSON `LocEntry`. It is export-only (regenerated from the cast each export, never read back by `applyLoc`) and the compiler strips it from the runtime bundle alongside `notes`.
- c61c146: Add a per-line "needs re-record" flag (#227). `AuthoringFile.rerecord` (beat id -> true) marks a dialogue take that exists but must be redone; the new reserved `RERECORD_STATUS` masks the line's recording status everywhere it is read, so a "recorded" line still surfaces as work. `mergeAuthoring` now returns the `rerecord` set and ops exposes `effectiveRecording()`, which the recording script (`runVoiceScript`), the production report (`runReport`, with its own re-record bucket), and status browse (`runStatusBrowse`, filterable by `rerecord`) all resolve through. Authoring-only; never compiled into a bundle.

## 0.1.2

### Patch Changes

- 65f6ccb: Add the `autoRebuild` field to `ProjectFile` (Patterpad's opt-in auto-recompile setting). Editor-only, never reaches the bundle; this just lets the published model types describe it.

## 0.1.1

### Patch Changes

- 00bc37f: Add the `specificity` value to `SelectorOrder` (the Best match sequence selector). Type-only: the Best-match runtime behaviour ships in `@patterkit/runtime`, and the compiler carries the mode verbatim; this just lets the published model types describe it.
