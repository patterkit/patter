# @patterkit/core

## 0.9.5

### Patch Changes

- af73dcf: Claims on host fields, and the manifest settings that named them, are gone from Patter extensions (ruled 2026-10-20, with `@wildwinter/toolkit` 0.3.0, which warns `removed-key` on a manifest that still has `settings` or a target's `claims`, and ignores them). The model drops `ProjectExtension.settings` and `BundleExtension.settings`. The compiler no longer checks a pin's settings or a claim on a gameData field, and the bundle carries no `extensions[id].settings`. `patter validate` warns once per extension whose pin in the project file still has `settings`, since nothing reads them now; the compile ignores them. The project file's three-way merge no longer merges a pin's settings key by key: each key of a pin merges as one value.
- Updated dependencies [af73dcf]
  - @patterkit/model@0.20.0

## 0.9.4

### Patch Changes

- 105884d: Patter extensions can declare a `pick` field (`@wildwinter/toolkit` 0.2.5): one choice from fixed words, the nodes of a reference kind such as the cast, and lists of text on the extension's own project node. The compiler checks each value against them, from the extension's project entry wherever its shard sits: a value no source holds is an error (`not-a-choice`), one two sources hold a warning (`pick-ambiguous`), and each name two sources hold is reported once for the project (`pick-clash`), so `patter validate` catches a misspelt name. A cast rename rewrites the pick values naming the member (`renameCastKeys`), as it rewrites references; a renamed entry of a project list isn't followed, so a value naming the old entry is reported missing.
- 35964cc: Version-control setup and `patter mergetool` now come from `@wildwinter/toolkit` 0.2.3's shared `vcs` module, the same copy Storylets uses. Every pattern, attribute, and command in the generated files is unchanged; their wording is tidied and their rows are column-aligned. `mergetool` keeps its order and exit codes.

## 0.9.3

### Patch Changes

- b1e5e0b: Merges follow the family's shared rules (`@wildwinter/toolkit` 0.2.2), as Storylets' do. Declaration lists (properties, cast, and each node type's gameData fields) keep the author's order instead of being re-sorted by name, so Move up and Move down survive a merge: the side that reordered wins, two different reorders clash, and the other side's additions go in after the entry they followed. Comment threads merge message by message and field by field, so an edit to a message and a moved anchor are no longer lost, and a message edited two ways is a conflict. A line's tags merge as a set, so two people tagging one line no longer clash. Conflict paths into a declaration list now name the entry in brackets (`cast[PLAYER]`).
- Updated dependencies [0e0708a]
  - @patterkit/model@0.19.0

## 0.9.2

### Patch Changes

- Updated dependencies [f5775c7]
  - @patterkit/model@0.18.0

## 0.9.1

### Patch Changes

- e6aa49e: Depends on `@wildwinter/toolkit` ^0.2.1, where a Patter extension's claim may leave out an enum's or flags' values, or a quality's stages, and take the project's gameData field's.
- Updated dependencies [e6aa49e]
  - @patterkit/model@0.17.0

## 0.9.0

### Minor Changes

- 54fb3be: An option's game-data values are checked against the project's `option` fields, as every other node kind's are. Any other group's gameData is still left alone.

### Patch Changes

- 247a652: Depends on `@wildwinter/toolkit` 0.2.0, which carries the shared extension spec and merge.
- Updated dependencies [54fb3be]
- Updated dependencies [247a652]
  - @patterkit/model@0.16.0

## 0.8.0

### Minor Changes

- f3e1277: Game data is checked by the family's rules. A field declaration: an enum or flags field lists its values, a quality field's ladder follows the shared quality rule, and a given default fits its type (an enum's may be `""`, none chosen). Every node's values: each fits its field, by `valueFits` from `@wildwinter/expr`; a quality value off its ladder is an `invalid-gamedata-value` error whose `offLadder` names the stages to offer instead. A key no field declares is left alone. A property's default is checked by the same `valueFits`.

### Patch Changes

- Updated dependencies [f3e1277]
  - @patterkit/model@0.15.0

## 0.7.1

### Patch Changes

- 6c7eb79: A quality's declaration is checked by the family's shared rule, `qualityDeclarationProblems` from `@wildwinter/expr` 0.5.2, so Patter and Storylets can't disagree about it: at least two stages, none empty, none twice, and a default on the ladder. The messages are the same as before.

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

## 0.6.2

### Patch Changes

- db35050: Each package now carries the MIT licence text (LICENSE) in its own folder, so the licence travels with every install.
- Updated dependencies [db35050]
  - @patterkit/model@0.13.1

## 0.6.1

### Patch Changes

- Updated dependencies [b3ecb18]
  - @patterkit/model@0.13.0

## 0.6.0

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

- Updated dependencies [09f4abc]
- Updated dependencies [9630c0e]
  - @patterkit/model@0.12.0

## 0.5.0

### Minor Changes

- a4db109: Speaker qualifiers: a line can say how it is delivered, a screenplay's `TAM (O.S.)`, without becoming a second character.

  - `@patterkit/model`: `LineBeat.qualifier` (the qualifier's `gameId`), `ProjectFile.qualifiers` with `DEFAULT_QUALIFIERS` (`V.O.`, `O.S.`, `RADIO`), `projectQualifiers`, `usedQualifiers`, `qualifierStringKey`, `Bundle.qualifiers`, the qualifier on a saved choice prompt, and qualifier slots on handoff lines and suggestions.
  - `@patterkit/core`: `validateProject` reports a line whose qualifier isn't in the project's list (`unknown-qualifier`) and a malformed list (`invalid-qualifier`).
  - `@patterkit/compiler`: the bundle carries the qualifiers the lines use, and folds them into its hashes; a project that uses none compiles exactly as before.

### Patch Changes

- Updated dependencies [a4db109]
  - @patterkit/model@0.11.0

## 0.4.1

### Patch Changes

- b4a4a39: `validateProject` reports a block or scene with no id or no name (`missing-id`, `missing-name`) rather than throwing a TypeError on it.

## 0.4.0

### Minor Changes

- 873585e: `ValidationIssue` gains `severity: "warning"` for issues that still build: a choice that can run dry is now one, and a new `jump-cycle` warning flags snippets that jump to each other with nothing to deliver. A beat of a kind the runtime does not know is a `malformed-node` error.

### Patch Changes

- Updated dependencies [caaf755]
  - @patterkit/model@0.10.0

## 0.3.2

### Patch Changes

- Updated dependencies [5ac9fb2]
  - @patterkit/model@0.9.0

## 0.3.1

### Patch Changes

- Updated dependencies [6da8b0c]
  - @patterkit/model@0.8.0

## 0.3.0

### Minor Changes

- 2984ec6: `@patterkit/core`: `planProject({ name })` and `planScene(target, scaffold)`, for another tool to create a Patter project beside its own and hand a writer a stub scene. Storyletter uses it for a card in a box Patter performs that has no scene yet: the scene is named after the card, its address pinned to the card's gameId, the card's purpose as its opening line, and one option per outcome labelled with that outcome's gameId in its Game Data (no choice for a card with one outcome). Pure: it returns project-relative paths and canonical content for the caller to write.

## 0.2.6

### Patch Changes

- Updated dependencies [40befdb]
  - @patterkit/model@0.7.0

## 0.2.5

### Patch Changes

- Updated dependencies [b91b7e1]
- Updated dependencies [7f3db84]
  - @patterkit/model@0.6.0

## 0.2.4

### Patch Changes

- df4cd3a: The readable script (Publish ▸ Readable Script, .pdf and .docx) names the block a condition refers to, instead of printing its id: `‹ if not seen(Intro) ›`, the way the editor has always shown it. `visits()` / `seen()` take a node id and Patterpad writes it as a bareword, but the export's copy of the read-out-loud rule only matched a QUOTED id, so real scripts went out reading `‹ if not seen(blk_lcd858q2) ›`.

  The rule now lives once, in `@patterkit/core` as `humanizeNodeRefs`, and both the editor's condition tag and the script export take it from there. Reported by jlafos in #64.

## 0.2.3

### Patch Changes

- Updated dependencies [44e9696]
  - @patterkit/model@0.5.0

## 0.2.2

### Patch Changes

- 2a16584: Move to @wildwinter/expr 0.5.0 and the new @wildwinter/toolkit.

  Opaque ids, the FNV-1a hash, JSON5 source parsing, the find/replace matcher and
  the archive guards now come from @wildwinter/toolkit instead of being
  maintained here and, separately, in the Storylet Engine. No behaviour change:
  the implementations moved, they were not rewritten.

- Updated dependencies [2a16584]
  - @patterkit/model@0.4.1

## 0.2.1

### Patch Changes

- f97f6eb: The `quality` property type (from @wildwinter/expr 0.4.0): a story stage as an ORDERED ladder of named
  stages. Declarations carry `stages`; ordering operators compare by ladder position; `advance()` steps
  to the next stage, saturating at the last; a stage name off the ladder is a compile-time error, and a
  quality with fewer than two stages or duplicate stage names is an invalid declaration. Saves carry the
  stage NAME, so inserting a stage mid-production shifts nothing. Coverage proposals random-walk a
  quality's stages, and the play-helpers state inspector edits one as a dropdown of its ladder.
- Updated dependencies [f97f6eb]
  - @patterkit/model@0.4.0

## 0.2.0

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

### Patch Changes

- Updated dependencies [614eaa8]
  - @patterkit/model@0.3.0

## 0.1.5

### Patch Changes

- Updated dependencies [b14eadf]
  - @patterkit/model@0.2.1

## 0.1.4

### Patch Changes

- 178967e: `validate` no longer flags per-beat authoring metadata (writing/recording status, cut flag, documentation notes) keyed on an id that no longer exists. Deleting a beat leaves that metadata behind as harmless residue - it never ships and has no runtime effect, exactly like an orphaned comment - so it is now ignored rather than reported as a structural error (which also kept `patter validate` from returning ok on a project with any stale metadata). Status-value-not-in-ladder and undeclared-doc-class checks still apply to LIVE beats. The `unknown-status-id` issue code is removed.

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
