# @patterkit/ops

## 0.24.0

### Minor Changes

- af73dcf: Claims on host fields, and the manifest settings that named them, are gone from Patter extensions (ruled 2026-10-20, with `@wildwinter/toolkit` 0.3.0, which warns `removed-key` on a manifest that still has `settings` or a target's `claims`, and ignores them). The model drops `ProjectExtension.settings` and `BundleExtension.settings`. The compiler no longer checks a pin's settings or a claim on a gameData field, and the bundle carries no `extensions[id].settings`. `patter validate` warns once per extension whose pin in the project file still has `settings`, since nothing reads them now; the compile ignores them. The project file's three-way merge no longer merges a pin's settings key by key: each key of a pin merges as one value.

### Patch Changes

- eb11df2: Uses `@patterkit/runtime` 0.34.0, the Patterplay 0.34.0 release.
- Updated dependencies [af73dcf]
  - @patterkit/model@0.20.0
  - @patterkit/compiler@0.14.0
  - @patterkit/core@0.9.5
  - @patterkit/dialect@0.2.17

## 0.23.0

### Minor Changes

- b0e8f5e: `runFieldBrowse(loaded, query, focus?)` finds every node by a gameData field's value (`mood`, `mood = tense`, `mood != calm`), read by `@wildwinter/toolkit`'s shared field matcher, so Patterpad's and Storyletter's Field tabs read a query the same way. The value tested is the one that holds: the node's own, else the field's declared default. Each row carries a `field` (name, type, the value as text, and `isDefault`). `listGameDataFields(loaded)` lists the declared fields by name with the node kinds that declare them.
- 105884d: Patter extensions can declare a `pick` field (`@wildwinter/toolkit` 0.2.5): one choice from fixed words, the nodes of a reference kind such as the cast, and lists of text on the extension's own project node. The compiler checks each value against them, from the extension's project entry wherever its shard sits: a value no source holds is an error (`not-a-choice`), one two sources hold a warning (`pick-ambiguous`), and each name two sources hold is reported once for the project (`pick-clash`), so `patter validate` catches a misspelt name. A cast rename rewrites the pick values naming the member (`renameCastKeys`), as it rewrites references; a renamed entry of a project list isn't followed, so a value naming the old entry is reported missing.
- 3b48e93: `runReplace` also rewrites each node's own value for a gameData field declared `text` or `multiline` (family parity item 16, as Storyletter's replace covers string field values). Every `ReplaceHit` carries a `field`, `"text"` for the source prose or `field:<name>` for a gameData value, and `ReplaceOptions.onlyField` narrows `onlyId` to one of them. The plan's new `flows` holds the rewritten scenes, whose flow shard writes come last in `writes`. Other field types and declared defaults are never touched, and a field value stamps no `modifiedAt`, as it has no translations.

### Patch Changes

- 00db6be: Uses `@patterkit/runtime` 0.33.0, the Patterplay 0.33.0 release.
- 35964cc: Version-control setup and `patter mergetool` now come from `@wildwinter/toolkit` 0.2.3's shared `vcs` module, the same copy Storylets uses. Every pattern, attribute, and command in the generated files is unchanged; their wording is tidied and their rows are column-aligned. `mergetool` keeps its order and exit codes.
- Updated dependencies [105884d]
- Updated dependencies [35964cc]
  - @patterkit/compiler@0.13.0
  - @patterkit/core@0.9.4

## 0.22.0

### Minor Changes

- b1e5e0b: Merges follow the family's shared rules (`@wildwinter/toolkit` 0.2.2), as Storylets' do. Declaration lists (properties, cast, and each node type's gameData fields) keep the author's order instead of being re-sorted by name, so Move up and Move down survive a merge: the side that reordered wins, two different reorders clash, and the other side's additions go in after the entry they followed. Comment threads merge message by message and field by field, so an edit to a message and a moved anchor are no longer lost, and a message edited two ways is a conflict. A line's tags merge as a set, so two people tagging one line no longer clash. Conflict paths into a declaration list now name the entry in brackets (`cast[PLAYER]`).

### Patch Changes

- 0e0708a: One exported rule for a scene reference: `resolveSceneRef(scenes, ref, byAddress?)` in the model resolves by the scene's address (its effective gameId) first, then its internal id, and `sceneAddressIndex(scenes)` builds the address lookup once for many references, so a tool that has to land where the game will calls the same function rather than keeping a copy. The runtime resolves with it, and ops' playable runtime is regenerated to match; nothing plays differently.
- 5a36907: Uses `@patterkit/runtime` 0.32.0, the Patterplay 0.32.0 release.
- Updated dependencies [b1e5e0b]
- Updated dependencies [b1e5e0b]
- Updated dependencies [0e0708a]
  - @patterkit/core@0.9.3
  - @patterkit/compiler@0.12.0
  - @patterkit/model@0.19.0
  - @patterkit/dialect@0.2.16

## 0.21.0

### Minor Changes

- f5775c7: Action text in the production tools. `extractLoc` leaves a dialogue scene's action text out; `applyLoc` drops any translation of it a shard still holds (`ApplyStats.dropped`), refuses one a file brings back, and marks each translated shard it writes with whether its scene's text was action (`textAction`). `actionTextChanges` lists the text that has dropped out of the loc files or come into them since, and `describeLocExport` words what an export says beside the file: how many text lines it left out as action, and the setting that does it, then those changes. `runValidate` warns, naming the scene, when a scene's kind no longer matches its loc files. `runReport` counts action beside the written lines (`action` on each scene and in the totals), never in them or in the localisation counts, and the report spreadsheet adds Action columns when there's any. The playable HTML export shows action as a direction, timed by its pause alone.

### Patch Changes

- f09d1c6: Uses `@patterkit/runtime` 0.31.0, the Patterplay 0.31.0 release.
- Updated dependencies [f5775c7]
- Updated dependencies [f5775c7]
  - @patterkit/compiler@0.11.0
  - @patterkit/model@0.18.0
  - @patterkit/core@0.9.2
  - @patterkit/dialect@0.2.15

## 0.20.1

### Patch Changes

- e6aa49e: Depends on `@wildwinter/toolkit` ^0.2.1, where a Patter extension's claim may leave out an enum's or flags' values, or a quality's stages, and take the project's gameData field's.
- 4e3e2d6: Uses `@patterkit/runtime` 0.30.0, the Patterplay 0.30.0 release.
- Updated dependencies [e6aa49e]
- Updated dependencies [e6aa49e]
- Updated dependencies [e6aa49e]
- Updated dependencies [e6aa49e]
  - @patterkit/compiler@0.10.0
  - @patterkit/core@0.9.1
  - @patterkit/model@0.17.0
  - @patterkit/dialect@0.2.14

## 0.20.0

### Minor Changes

- 54fb3be: `renameGameDataStage` reaches a choice's options for the `option` kind.
- 247a652: Validate checks a project's Patter extensions (`ValidateResult.extensions`): each manifest, the project's pins and settings, claims on gameData fields (an error when the project declares the field with another type, a warning when it doesn't declare it), and every value in the extension data against its manifest, with an entry for a node that has gone reported per entry and kept. An error fails `ok` and is an export blocker, so export refuses it; a warning doesn't, and that includes a missing manifest (the data is left as it is), an entry in another scene's shard, and a `.gitattributes` set up for Patter's merge with no rule for `.patterextension`. A pack carries the extensions' manifests, and unpack writes them back; merging a pack back merges extension data by the project's own manifest, and keeps the project's manifest where the pack's differs (`manifestsKept`). `patter init` sets up `.patterextension` shards and manifests for every version control system. `planExtensionUpgrades` takes an extension at its manifest's new version, renaming the stages it renamed in the data and moving the pin in one step, and `runFormat` runs it on a project folder (`FormatResult.notes`). A cast rename follows the name into the data (`renameCastKeys`: map keys and reference values to `cast`, at any depth, by the manifest), the lines (`renameCastInScene`), and the project-level strings keyed by it (`renameCastStrings`, `moveCastKeys`).
- 247a652: An unresolved merge is now marked in the shard itself, under `unresolved`, in every shard type: a mark either side already carries survives a clean merge until somebody removes it, and validate, export, and pack refuse a marked shard as they refuse a `.patterconflict` sidecar (`unresolvedMarkIssues`). Extension data shards (`.patterextension`) load with the project, pack, format, and merge, field by field when `runMerge` is handed the extension's manifest and each node's entry whole when it isn't; `readProjectManifest` and `projectManifests` read a project's manifest as a merge needs it. A project's `extensions` merge per extension, the pin and each setting on their own, and two duplicate ids after a flow merge are now two conflicts rather than one. Patter's own mergers stay hand-written for now: the flow merge's ordered weave and the authoring merge's edit clock have no counterpart in the shared merge engine yet. `compileLoaded` compiles a project's extension values into the bundle, and `loadedExtensions` gives a loaded project's extension files as the compiler's extension pass reads them.

### Patch Changes

- e31f3db: Uses `@patterkit/runtime` 0.29.0, the Patterplay 0.29.0 release.
- Updated dependencies [54fb3be]
- Updated dependencies [54fb3be]
- Updated dependencies [247a652]
- Updated dependencies [247a652]
- Updated dependencies [247a652]
  - @patterkit/core@0.9.0
  - @patterkit/model@0.16.0
  - @patterkit/compiler@0.9.0
  - @patterkit/dialect@0.2.13

## 0.19.0

### Minor Changes

- f3e1277: `renameGameDataStage` carries a quality game-data field's stage rename into every node of its type that holds the old name. The stage-literal rewrite and the gate count are now the kernel's (`renameStageInExpression` and `stageGateCount` from `@wildwinter/expr`, shared with Storyletter); `stageGateCount` counts each gate, two in one condition being two. A node's `gameData` merges per key, so two writers setting different fields on one node both land. Coverage proposes, for a quality gate, the stages either side of it in ladder order (`stagesEitherSide`), not every stage sorted by name.

### Patch Changes

- cd8a91a: Uses `@patterkit/runtime` 0.28.0, the Patterplay 0.28.0 release.
- Updated dependencies [f3e1277]
- Updated dependencies [f3e1277]
- Updated dependencies [f3e1277]
- Updated dependencies [f3e1277]
  - @patterkit/core@0.8.0
  - @patterkit/compiler@0.8.0
  - @patterkit/dialect@0.2.12
  - @patterkit/model@0.15.0

## 0.18.0

### Minor Changes

- 6c7eb79: `renameStage` carries a quality's stage rename into every condition and set effect that names the stage, across the scenes it can reach, and `stageGateCount` says how many expressions order the quality by its stages, which is what a reorder changes. `renameStageInExpression` and `stageDialect` are the pieces, for a caller with its own expressions.

### Patch Changes

- 9c2b88b: Uses `@patterkit/runtime` 0.27.0, the Patterplay 0.27.0 release.
- Updated dependencies [6c7eb79]
  - @patterkit/core@0.7.1
  - @patterkit/compiler@0.7.1

## 0.17.2

### Patch Changes

- 68302a3: Uses `@patterkit/runtime` 0.26.1, the Patterplay 0.26.1 release.

## 0.17.1

### Patch Changes

- 1c849f7: Uses `@patterkit/runtime` 0.26.0, the Patterplay 0.26.0 release.
- 8ff7d3d: The runtime inlined in playable HTML exports is refreshed to this one (it gains `flow.stepFor`).

## 0.17.0

### Minor Changes

- 1a3f2db: Speaker labels: how a game shows a qualified speaker's name.

  - `@patterkit/model`: `CastMember.qualifierLabels` (a character's own label with a qualifier, by the qualifier's Game ID), `ProjectFile.speakerPattern` and `Bundle.speakerPattern` (`{name} ({qualifier})` by default), `SavedChoicePrompt.speakerLabel`, and the helpers `speakerLabelKey`, `SPEAKER_PATTERN_KEY`, `DEFAULT_SPEAKER_PATTERN`, `formatSpeakerLabel`, and `usedSpeakerPairs`.
  - `@patterkit/core`: `validateProject` reports a speaker pattern or a character's labels that aren't text (`invalid-speaker-label`), and warns on a character's own label for a pair no line uses (`unused-speaker-label`).
  - `@patterkit/compiler`: the bundle carries the project's speaker pattern when it isn't the default, and each character's own labels for the pairs the lines use.
  - `@patterkit/ops`: localisation exports carry the speaker pattern (`speaker:pattern`, with a note for translators) when the lines use a qualifier, and a `speaker:<NAME>:<qualifier>` string for each pair the writer gave a label of its own; both read back on import. The playable HTML shows the step's speaker label. A project merge merges cast members field by field, and a character's labels pair by pair, so two branches that each change a different field, or each add a label, both land.
  - `@patterkit/ops`: `projectStringSources(project, sourceTable)` gives the source text of every project-level string (display names, qualifier names, the speaker pattern, and pair labels), the one rule the localisation export and an editor's stale tracking share; `authoringPath` is exported beside it.

### Patch Changes

- 6c805cd: Uses `@patterkit/runtime` 0.25.0, the Patterplay 0.25.0 release.
- Updated dependencies [1a3f2db]
  - @patterkit/model@0.14.0
  - @patterkit/core@0.7.0
  - @patterkit/compiler@0.7.0

## 0.16.2

### Patch Changes

- db35050: The readable-script PDF fonts now come from their upstream npm packages (Fontsource for Newsreader, Inter and Noto; IBM's own release of Plex Mono) instead of a copy inlined into ops, so ops drops from 2.9 MB to 0.4 MB and the fonts arrive with their own licences. Greek, Cyrillic, arrows and maths fall back to Noto Sans and Noto Sans Math instead of DejaVu Sans. The npm CLI is now a thin build (43 KB, down from 8.4 MB) whose dependencies install from npm beside it; the standalone binaries are still one self-contained file each, fonts included. New `patter licences` (also `licenses`) prints patter's own licence, the licence of every font the PDF export embeds, and, in a standalone binary, the licence and copyright notice of every library compiled into it.
- db35050: Each package now carries the MIT licence text (LICENSE) in its own folder, so the licence travels with every install.
- Updated dependencies [db35050]
  - @patterkit/model@0.13.1
  - @patterkit/core@0.6.2
  - @patterkit/compiler@0.6.2

## 0.16.1

### Patch Changes

- b3ecb18: - `@patterkit/model`: `FlowState`, one flow taken out of a game as plain data (its `FlowSnapshot`, a `version`, and its own property values), and `FlowValues`, those values in a version 2 save's per-flow spelling (`scopes` and `sceneBags`). `FlowSnapshotV2` is now `FlowSnapshot` plus `FlowValues`, the same shape as before.

  - `@patterkit/ops`: the runtime inlined in playable HTML exports is refreshed to this one.

- 07e5628: Uses `@patterkit/runtime` 0.24.0, the Patterplay 0.24.0 release.
- Updated dependencies [b3ecb18]
  - @patterkit/model@0.13.0
  - @patterkit/compiler@0.6.1
  - @patterkit/core@0.6.1

## 0.16.0

### Minor Changes

- 9e20199: Line padding in the playable HTML: each line is timed by a reading estimate (the same one Patterstage uses), then by the writer's pause after it, with cut-ins overlapping the line before. Speed becomes Half, Normal, Double, and Instant, and a saved Slow or Fast choice carries over. Play events carry `padAfter`. The recording script and the screenplay are unchanged.

### Patch Changes

- 6d88383: Uses `@patterkit/runtime` 0.23.0, the Patterplay 0.23.0 release.
- 9630c0e: Speaker qualifiers and line padding, tidied after review.

  - `@patterkit/model`: `HandoffLine.qualifierName`, the qualifier's name as the editable script's cue printed it. Optional, so older handoff records still load.
  - `@patterkit/core`: `validateProject` warns on a qualifier on a line with no speaker (`qualifier-without-speaker`), and on a negative pause on an option's prompt when the option plays no beat (`prompt-pad-without-beat`); it reports a qualifier list that isn't a list, or holds an entry that isn't a qualifier, as `invalid-qualifier` instead of throwing.
  - `@patterkit/ops`: reimporting an editable script reads each cue against the qualifier name it was printed with, so renaming a qualifier in settings after export no longer reads an untouched cue as a change. The project merge merges `qualifiers` per `gameId`, so two branches each adding one both land.

- Updated dependencies [09f4abc]
- Updated dependencies [9630c0e]
  - @patterkit/model@0.12.0
  - @patterkit/core@0.6.0
  - @patterkit/compiler@0.6.0

## 0.15.0

### Minor Changes

- a4db109: Speaker qualifiers in the exports. The screenplay (PDF and DOCX), the playable HTML, and `patter play` print a qualified cue as `TAM (O.S.)`; the voice script gains a Qualifier column, with lines still under the one character; localisation exports carry a line's qualifier as read-only context and the qualifier names as project-level strings; and the editable script handoff sends the qualifier in the cue and reads a changed one back as a suggestion. `patter suggestions` lists a qualifier change. `@patterkit/ops` exports `cueLabel` and `qualifierNamer`.

### Patch Changes

- 73cbed5: Uses `@patterkit/runtime` 0.22.0, the Patterplay 0.22.0 release.
- Updated dependencies [a4db109]
  - @patterkit/model@0.11.0
  - @patterkit/core@0.5.0
  - @patterkit/compiler@0.5.0

## 0.14.2

### Patch Changes

- Updated dependencies [b4a4a39]
  - @patterkit/core@0.4.1
  - @patterkit/compiler@0.4.7

## 0.14.1

### Patch Changes

- aba7994: Uses `@patterkit/runtime` 0.21.0, the Patterplay 0.21.0 release.

## 0.14.0

### Minor Changes

- 873585e: The CLI review of October 2026, in the operations the CLI and Patterpad share.

  - Unpack writes only what a pack of Patter's carries (shards, scopes files, handoff records), refuses any entry with a dot-file or dot-folder in its path, returns the rest unwritten in `other`, throws `NotAPackError` for a file that is not a pack, and refuses a folder holding a different project. Unpack-merge skips shards nobody changed (no parse, no write), never brings back a shard the recipient deleted, and reports `changed` per shard.
  - An authoring merge keeps comment replies, resolves, and reopens from both sides, and a deleted message stays deleted. Merge types are matched by the schema's exact name.
  - Localisation import refuses a scene the project lacks or a language it does not declare, before planning any write. Catalogue scene and locale values are checked when read; PO escapes round-trip in one pass; formatted spreadsheet cells import as their text; spreadsheet sheet names are made safe and unique, with the scene id in a hidden column.
  - `runExport` refuses content validate finds errors in (`allowInvalid` to build anyway), and `runExportHtml` with it. New `planBuild` returns everything a build writes (bundle, `patter.scopes.json`, the Audio Folders manifest) for every front end. New `compileLoaded` is the one compile export and every analysis use, so a fresh bundle is no longer stale and coverage counts only beats that ship. `bundleOutputPath` defaults to `../patter-dist/<name>.patterc`; new `defaultBundlePath` and `besideBundlePath`.
  - The Audio Folders rules and the manifest are now ops' (`scanAudio`, `pickAudio`, `audioManifest`, `audioManifestWrite`).
  - `runValidate` compiles once and never throws on loc shards that disagree: new `localisation` issues report a clash against both files, and as warnings a shard for an unknown scene or language or a second shard for one. A choice that can run dry is a warning and no longer switches reachability off; content naming another engine's scope with no game scopes folder is a warning; the staleness check reads the bundle as strict JSON, wherever the project writes it. Validate walks the tree once.
  - Reachability treats only `@patter` and `@scene` as latches. Coverage witnesses each write site by its own visit count, records a run the engine stopped as a content error, and its input hint follows gated jumps and ignores shadowed branches. `runPlay` keeps the transcript when the engine throws (outcome `error`) and names a scripted choice that is not on offer.
  - `format` formats only shards, and takes a project folder. Replace stamps `modifiedAt`, so translations go stale. `--block` without a scene is resolved across scenes. An off-ladder writing status counts as the lowest rung everywhere. The voice script includes spoken choice prompts. `init` plans the project file last; new `currentBundlePosture`.
  - Reachability treats a shared `@patter` property as no latch when the game keeps a game scopes folder, since another engine on the game's registry may set it back. The report counts the lines inside a cut block, group, or snippet as cut, as the voice script does. The landing load takes only the source language's strings. A game scopes file that can't be read is left out of a pack rather than failing it.
  - Coverage's second hop (`blockedBy`) follows gated jumps: a beat whose block is entered only past a gate whose writers never ran is blocked by that gate, marked `onTheWayIn`.

### Patch Changes

- Updated dependencies [873585e]
- Updated dependencies [873585e]
- Updated dependencies [caaf755]
  - @patterkit/compiler@0.4.6
  - @patterkit/core@0.4.0
  - @patterkit/model@0.10.0

## 0.13.1

### Patch Changes

- 6e115b2: The coverage summary no longer says "0 stalled at a choice with nothing to pick": a run can't stall any more, since a choice with nothing to pick runs dry, so a stall is named only if one ever happens.
- 360912a: Playable HTML exports carry the runtime's fix for a restart that replayed the abandoned run's chosen prompt.
- 2cfd00e: Playable HTML exports carry the runtime's `onTrace` fix: a tool tracing a run without the decision log now hears every decision.
- 1892462: Uses `@patterkit/runtime` 0.20.0, the Patterplay 0.20.0 release.

## 0.13.0

### Minor Changes

- c7dad40: Coverage and playthroughs report content errors. The runtime now plays through a condition or effect that fails (a failing condition counts as false, a failing effect is skipped), so the coverage report gains `contentErrors`: each failure with its kind, node, scene, source, message, and the number of runs it happened in, also listed in `renderCoverageText`. `runPlay` records each as an `error` event in order, and `renderPlay` marks it with `!`. Playable HTML exports carry the runtime's new play rules.

### Patch Changes

- 076831c: Playable HTML exports carry `@wildwinter/expr` 0.5.1 and `@wildwinter/scoperegistry` 0.8.1 (expression kernel `k492cf234`): a listener's own error is no longer reported as a read-only refusal, and every listener registered when a write starts hears it exactly once.
- a7ab2f3: Playable HTML exports carry the runtime's latest fixes: a rollback after a load keeps a scene's saved `@scene` values, and the decision log's `seq` keeps counting after a clear.
- 6a30def: Uses `@patterkit/runtime` 0.19.0, the Patterplay 0.19.0 release.

## 0.12.5

### Patch Changes

- c062a42: Uses `@patterkit/runtime` 0.18.0, the Patterplay 0.18.0 release.
- 5ac9fb2: The save shape gains an optional `FlowCursor.pendingPrompt`: the prompt `replayPromptOnChoose` is still to speak back, as the choice showed it. The runtime inlined into playable HTML exports is refreshed to the current engine (only an authored prompt is replayed, exactly as shown).
- Updated dependencies [5ac9fb2]
  - @patterkit/model@0.9.0
  - @patterkit/compiler@0.4.5
  - @patterkit/core@0.3.2

## 0.12.4

### Patch Changes

- 05e5456: The runtime inlined into playable HTML exports is refreshed to the current engine (opening a flow at an address that doesn't resolve now changes nothing).
- 7ea470f: Uses `@patterkit/runtime` 0.17.0, the Patterplay 0.17.0 release.

## 0.12.3

### Patch Changes

- 808e57c: The runtime inlined into playable HTML exports is refreshed to the current engine (checkpoints, and a live flow restore that keeps the flow's own property values).
- 65c1fe4: Uses `@patterkit/runtime` 0.16.0, the Patterplay 0.16.0 release.

## 0.12.2

### Patch Changes

- 2797c6f: Uses `@patterkit/runtime` 0.15.0, the Patterplay 0.15.0 release.

## 0.12.1

### Patch Changes

- 1224219: The same contents as 0.12.0 (the editable script round trip), whose publish to npm didn't complete.

## 0.12.0

### Minor Changes

- 70727ec: `exportEditableScript` writes the editable script: the readable script with every editable line's words in a shaded box beside a `[#K7Q2M]` marker, a front page explaining how to edit it and read its structure, and the handoff id in the page header, plus the handoff record to commit. It opens and edits in Word, Google Docs, OnlyOffice, and Pages.
- e7b78e9: Editable script handoff records, the file side. `handoffs/<id>.json` records are read (`readHandoffs`, `readHandoff`) and written (`handoffWrite`), with the markers that tie a returned document's lines back to them (`issueMarkerCodes`, `formatMarker`, `readMarker`: Crockford base32 with a check character, read leniently). A `.patterpack` now carries the project's open handoff records; unpacking writes them, and a merge-unpack adds the other side's reimports to a record the project already has.
- ed6e4ec: `planEditableImport` brings a returned editable script back as Suggestions and Comments, checked against the handoff record: changed lines become suggestions credited to their tracked-change authors (a cut when a box was emptied, a speaker or direction change from the cue cell), the editor's comments and inline `[[notes]]` become comment threads on their line or node, and anything that can't be a suggestion (changed `{@…}` placeholders, a copied box, text typed outside the boxes, an edited context row) becomes a comment quoting the editor's words. Damaged markers are matched by position, moved lines are noted, a file with over a quarter of its lines missing is refused, a re-import replaces the handoff's still-open suggestions, and `direct` accepts the clean ones on the way in. Pure: it returns the writes and a report.
- 8a8f4bd: `readEditableDocx` reads a returned editable script: every box by its marker (recovered from a tracked deletion if need be), each box's words with tracked changes both accepted and rejected (so a tracked edit is told from an untracked one, and every change keeps its author), bold and italic as markup, the comments with their authors and replies, and the handoff id from the page header. Boxes are still found when a tool has merged neighbouring tables. Adds `@xmldom/xmldom` as a dependency.
- 3f0fd1c: `listOpenSuggestions` lists a project's open suggestions (optionally from one handoff), each with the parts that have changed since it was made, so a review can tell clean ones from out-of-date ones; `staleParts` is the same rule for one suggestion.
- 20c4fca: `runScriptDoc` elements now carry the id of the scene, block, node, or beat they show (an option also its node, a jump its target), and the function takes options: `scenes` to export a range, and `notes` to include documentation notes for a channel, or all classed notes. The readable script asks for neither, so its output is unchanged.
- 48a9a9e: `applySuggestionDecisions` accepts or rejects suggestions on the project's files, for reviewing many at once: an accept applies every part a suggestion carries (text, speaker, direction, cut) and stamps the line's edit time so its translations read as stale, and a suggestion whose text or speaker changed since it was made is refused as stale rather than applied over the newer work. `setCut` marks nodes or beats cut, or brings them back.

### Patch Changes

- 94903d5: In the editable script, speaker names and option marks sit right-aligned, against the box they belong to.
- 29de2d9: The editable script's front page no longer asks the editor to turn on Track Changes: edits come back either way, since each line is compared with what was sent. Tracked changes still credit each change to its author.
- 2284691: In the editable script, a narration line's box has no speaker cell, so it starts flush left and reads apart from dialogue rather than as the previous speaker carrying on. The front page's numbered rules and structure key no longer run each label into its text in Google Docs.
- da2fa9d: Reading a returned editable script no longer reports "formatting was dropped" for the script's own colours and box fill, which Google Docs copies onto every run when it saves a document; a colour, highlight, or underline the editor added is still noticed.
- fcdf695: Reimporting an editable script saved from Pages no longer reports dropped formatting on every line: the underline colour Pages writes on each run, with no underline, isn't counted.
- 5cc052b: The inlined playable-runtime snapshot is refreshed for the scene and block gameData reads
  (`gameDataForScene`, `gameDataForBlock`), so a playable HTML export ships a runtime that has them.
- bc4e31e: The readable script (.docx) now sets its labels and cues in Arial and its conditions, properties and game events in Courier New, in place of Calibri and Consolas. All three of its fonts (with Georgia) ship with macOS and Windows and are offered by Google Docs and Word for the web, so Pages no longer warns about missing fonts.
- Updated dependencies [6da8b0c]
  - @patterkit/model@0.8.0
  - @patterkit/compiler@0.4.4
  - @patterkit/core@0.3.1

## 0.11.0

### Minor Changes

- 72c625f: Coverage leads with what it reached least. A beat that played, but in fewer than 5% of runs, is now flagged as rarely reached (`rare` on the beat, `totals.rare` and `rareThresholdPct` on the report, `~` in the text), and `leastReachedFirst` gives the ordering. `patter coverage` now lists beats least reached first, with `--order script` for the script's order; its table labels its two columns (reached, played) and says in words how the runs ended.

## 0.10.4

### Patch Changes

- d899437: Uses `@patterkit/runtime` 0.14.3, the Patterplay 0.14.3 release.

## 0.10.3

### Patch Changes

- 446c2ca: Uses `@patterkit/runtime` 0.14.2, the Patterplay 0.14.2 release.
- dc7ff54: `@wildwinter/scoperegistry` is now a peer dependency, as it is of `@patterkit/runtime`: a game and every engine in it share one registry, so an install must hold exactly one copy. npm installs it for you; if two packages ever need versions that cannot be one copy, the install stops and says so instead of adding a second.
- Updated dependencies [dc7ff54]
  - @patterkit/compiler@0.4.3

## 0.10.2

### Patch Changes

- ba3d8ec: Accept any `@wildwinter/scoperegistry` from 0.8.0 up to 1.0, so an install keeps one copy of the registry that a game and every engine share, and a later registry release cannot split it into two. `@patterkit/play-helpers` and `@patterkit/ops` also move to `@patterkit/runtime` 0.14.1, which accepts the same range; with 0.14.0 an install held two copies.
- Updated dependencies [ba3d8ec]
  - @patterkit/compiler@0.4.2

## 0.10.1

### Patch Changes

- Updated dependencies [2984ec6]
  - @patterkit/core@0.3.0
  - @patterkit/compiler@0.4.1

## 0.10.0

### Minor Changes

- e4e7921: `@patterkit/ops`: `planPins(loaded)`, pin on publish. It plans writing down every scene and block Game ID that still follows its name, at the address it already has, and returns what it pinned, the flow-shard writes, and the rewritten scenes for an editor's in-memory copy. Patterpad's Publish Bundle calls it; nothing else does, the CLI's `export` included, because a build in CI must never write source.

## 0.9.0

### Minor Changes

- 18da398: `@patterkit/cli`: `share-scopes [path] [--at dir]`, the terminal's version of Patterpad's File > Share Scopes with Other Tools. It makes the game's `game-scopes/` folder (in `--at`, else at the version-control root above the project) with `patter.scopes.json` and a `game.scopes.json` holding the project's World properties, names a folder the project wouldn't find by looking up in its `gameScopes`, and refuses a project that already shares its scopes.

  `@patterkit/ops`: `planShareScopes` joins a folder another tool already made instead of replacing its `game.scopes.json`: every scope the file holds is kept, and only the project's game scopes it lacks are added. It returns `{ error }`, and plans nothing, when that file won't parse.

## 0.8.0

### Minor Changes

- 40befdb: Packs carry the game's shared scopes (patterkit/design/shared-scopes.md, "Packs").

  `@patterkit/ops`: where the project has a game scopes folder (found as the loaders find it, `gameScopes` override included), `runPack` carries every `*.scopes.json` in it as `game-scopes/<name>` entries, as the files are on disk, and the manifest (`DocumentManifest`) gains an optional sorted `gameScopes` list of their names. A project with no folder packs to the same bytes as before. `runUnpack` now returns `{ shards, scopes }` (it returned the shard writes as an array): `scopes` plans the snapshot into `<targetDir>/game-scopes/`, where the unpacked project finds it first, and is empty for a pack without one. `runUnpackMerge` never writes a returned pack's snapshot; when the project has a game scopes folder and the returned project file's copy of the game's scopes differs from the base pack's (the recipient edited World properties), it adds a write of the scopes they changed to `game.scopes.json`, keeping the file's other scopes, and reports it as `gameScopes: { path }` (with `error`, and no write, when that file won't parse). New helpers: `gameScopesSnapshot`, `planReturnedWorld`, and the `UnpackResult` type.

  `@patterkit/cli`: `unpack` writes and lists a pack's game scopes snapshot, and `unpack --merge` prints a `game scopes:` line when it writes the recipient's World edit to `game.scopes.json` (or a warning when that file won't parse).

- 40befdb: Shared game scopes (requires `@wildwinter/scoperegistry` ^0.8.0). A game can keep one `game-scopes/` folder where each editing tool writes the properties it declares and reads the others'.

  `@patterkit/model`: `ProjectFile.gameScopes`, a path (relative to the project file) naming the folder when the walk-up from the project would not find it.

  `@patterkit/compiler`: `validateConditions` and `validateInterpolation` take `gameScopes` (the merged folder) and check every scope in it the host spec doesn't hold, with warnings only: an undeclared name (worded by `referenceNote`), a type mismatch, or a write to a read-only property. `exportBundle` takes `gameScopes` too: `game.scopes.json` wins over the project's copy of a host scope, its `@world` is baked into `scopeRegistry` even when the project doesn't declare it, and every other scope in the folder compiles as another engine's does, named in `externalScopes` and never baked in. New exports: `projectScopes`, `externalGameScopes`, `PATTER_SCOPE`, and `EXTERNAL_SCOPES` (re-exported from the dialect).

  `@patterkit/ops`: the loaders discover the folder (`LoadedProject.gameScopes`, `gameScopesMissing`), and export, validate, play, coverage, and reachability pass it on. `runValidate` gains `gameScopes` issues (a file that won't parse, a token two files claim, and a missing override are errors; `patter.scopes.json` out of date and the project's copy of a game scope differing are warnings), and `ok` now counts only errors among condition and interpolation issues. `runPlay` and coverage stand other engines in from the folder (`previewRegistry`) when the bundle names them. New helpers for editors: `patterScopesFile`, `patterScopesWrite`, `planWorldSave`, `planShareScopes`, `worldSettingsScopes`, `defaultGameScopesDir`, `gameScopesCatalogue`, `gameScopeTokens`.

  `@patterkit/cli`: `export` writes `game-scopes/patter.scopes.json` when there is a folder and the file would change; `validate` prints the folder's issues as `[game-scopes]`, and prints warnings as such without failing; `play` and `coverage` run content naming another engine's scope where the folder declares it.

### Patch Changes

- Updated dependencies [40befdb]
  - @patterkit/model@0.7.0
  - @patterkit/compiler@0.4.0
  - @patterkit/core@0.2.6

## 0.7.7

### Patch Changes

- b91b7e1: One registry per game. `SaveGame` is version 3 (`SAVE_VERSION`): it holds what is not a property, plus the engine's own registry's values under an optional `registry`, and the version 2 shape is kept as `SaveGameV2` / `FlowSnapshotV2` for readers. Registry keys for Patter's bags are documented beside the types.

  `@patterkit/play-helpers`: `snapshotState` reads the engine's bags directly rather than the save, so it keeps working now that a save carries no property values when the game owns the registry. Its path space is unchanged.

  `@patterkit/ops` carries the inlined runtime for playable-HTML exports, so its copy moves with the runtime.

- Updated dependencies [b91b7e1]
- Updated dependencies [7f3db84]
  - @patterkit/model@0.6.0
  - @patterkit/compiler@0.3.0
  - @patterkit/core@0.2.5

## 0.7.6

### Patch Changes

- df4cd3a: The readable script (Publish ▸ Readable Script, .pdf and .docx) names the block a condition refers to, instead of printing its id: `‹ if not seen(Intro) ›`, the way the editor has always shown it. `visits()` / `seen()` take a node id and Patterpad writes it as a bareword, but the export's copy of the read-out-loud rule only matched a QUOTED id, so real scripts went out reading `‹ if not seen(blk_lcd858q2) ›`.

  The rule now lives once, in `@patterkit/core` as `humanizeNodeRefs`, and both the editor's condition tag and the script export take it from there. Reported by jlafos in #64.

- Updated dependencies [df4cd3a]
  - @patterkit/core@0.2.4
  - @patterkit/compiler@0.2.8

## 0.7.5

### Patch Changes

- 2e81c41: Requires `@wildwinter/scoperegistry` ^0.6.0, whose `set` now takes an explicit host authority. A host-scope declaration's `writable: false` is the STORY's promise not to write the value, and only the story's: the game writes it through `Engine.setProperty` / `Flow.setProperty` whether the property is self-backed or bound to a resolver. The story's effects are refused exactly as before. This unblocks any host tooling that drives a read-only `@world` property, Patterplay's coverage drivers included.

  `@patterkit/ops` carries the inlined runtime for playable-HTML exports, so its copy moves with the runtime.

- Updated dependencies [2e81c41]
  - @patterkit/compiler@0.2.7

## 0.7.4

### Patch Changes

- 38dcf54: `patterplay.min.js`, the zero-build browser drop-in, is now built by `@patterkit/play-helpers` and carries the helpers as well as the runtime on the one `Patterplay` global: `serializeState`, `deserializeState`, the state logger, the inspectors, the Live Link client and audio resolution. A plain page with no bundler can now write and read the family's save text. The file ships from this package on unpkg / jsDelivr (`@patterkit/play-helpers/dist/patterplay.min.js`) and, as before, loose on every play-js release and inside its zip. `@patterkit/ops` bundles the runtime for playable HTML exports itself (runtime alone, as those exports always were), since the shared drop-in grew the helpers.

## 0.7.3

### Patch Changes

- 27d92dc: The not-in-project check decides from paths, not from what is in memory. It compared the disk walk with the loaded file lists, so a shard that appeared under its folder after the project was opened was reported as outside the project while sitting exactly where the loader reads from. Patterpad hit this on a scene's first save, whose edit trail creates the authoring shard. The folder is the rule now, as it is for the loader.
- 14a0ccc: A Patter file outside the project's folders is reported by name: the message gives its path relative to the project and the folder this project reads that kind from (`Move it under scenes/, or delete it.`), and a second project file names the one that is read. The CLI prints that message as is.

## 0.7.2

### Patch Changes

- 44e9696: The save format is now the family's contract, owned by `@patterkit/model`.

  `SaveEnvelope`, `SaveGame`, `FlowSnapshot`, `FlowCursor` and the rest of the `patter/save@0` shape are exported from the model (with `SAVE_SCHEMA`), and re-exported from `@patterkit/runtime` and `@patterkit/play-helpers` so existing imports keep working. Nothing the JS runtime writes has changed: its output was always this shape. What changed is that the three native ports now write and read it too, so a save crosses engines, and the conformance corpus carries a save the JS reference wrote that every runtime must load, write back with the same key paths, and continue.

  `@patterkit/ops` ships a fresh snapshot of the playable runtime, so an exported HTML script writes this shape too.

- Updated dependencies [44e9696]
  - @patterkit/model@0.5.0
  - @patterkit/compiler@0.2.6
  - @patterkit/core@0.2.3

## 0.7.1

### Patch Changes

- a958b9e: Rebuilds the embedded playable runtime.

  `runExportHtml` inlines a minified copy of `@patterkit/runtime`, so it carries a
  build of the runtime rather than a dependency on one. That copy is regenerated
  whenever the runtime's source changes; this picks up `listBags()` on the Engine
  and Flow, and the scene and stage state moving onto the shared property bag.

  No API change here.

## 0.7.0

### Minor Changes

- bd33b5c: The bundled playable-runtime carries the shared property row.

  `listProperties()` inside the inlined runtime now returns rows addressed by
  `path` rather than `ref`, and carrying `name` and `writable`. Anything reading
  those rows out of a playable HTML export sees the new shape.

  The blob is regenerated from the runtime by ops' prebuild, so this rides along
  with the runtime change rather than being a decision of its own.

## 0.6.0

### Minor Changes

- 2a16584: The bundled playable-runtime carries two behaviour changes.

  Flags compare as a set: `==` and `!=` ignore order, so `["red","blue"]` equals
  `["blue","red"]`, compared as multisets so a duplicate still counts. Order used
  to be significant, which meant `set_flags(@f, +red)` then `+blue` compared
  UNEQUAL to the same two flags added the other way round, a difference no author
  can see and none intends. A condition that was silently false on a reordered
  flags value now passes.

  The mulberry32 state is saved unsigned, where it was previously stored through
  `| 0` and so went negative in over half of all saves. Existing saves still
  load; new ones are readable by every Patterplay port.

  Both originate in @patterkit/runtime, which ships with the Patterplay lockstep
  set rather than through a changeset. This entry covers the blob ops bundles.

### Patch Changes

- Updated dependencies [2a16584]
  - @patterkit/core@0.2.2
  - @patterkit/model@0.4.1
  - @patterkit/compiler@0.2.5

## 0.5.0

### Minor Changes

- c37067b: Coverage: a never-reached beat now says when its gate is written only by content that was itself never reached.

  `needsInput` asks whether anything writes a gate and stops there, so a gate written only by a beat nobody reaches read as perfectly wired. `CoverageBeat.blockedBy` names the gate and the writers, turning two silent beats with one cause into a single question. Gates are keyed by individual flag (`@world.mood:armed`) rather than by property, since a property half the story writes always looks fed. The check refuses to speak where it cannot refute: an unwitnessed writer, or a property assigned wholesale, drops out rather than being guessed at.

- 7004f48: `validate` now reports conditions that provably can never hold.

  A snippet gated on `@connected && !@seen`, where the only writer of `@connected` is itself gated on `@seen` and nothing sets `@seen` back, is unsatisfiable. `ValidateResult.reachability` names the chain, and `patter validate` prints it as `[unreachable]`. The analysis covers monotonic latches only (a boolean only ever written `true`, a flag only ever `+set`); anything written another way, host-driven, `temporary`, or already true by default drops out rather than being guessed at, because a false "this can never happen" is worse than silence. Warnings, deliberately outside `ok`: they never fail a build. Adapted from a design contributed by the Storylet Studio side.

## 0.4.0

### Minor Changes

- 144311e: Close four holes in the merge path (from-storylets/merge-holes-worth-checking).

  **An authoring merge no longer drops fields.** `mergeAuthoring` built its result from a fixed key
  list, so `suggestions` and `rerecord` - added to the model after it was written - were discarded
  outright, from both sides, with no conflict and no warning. Suggestions are what a reviewer sends
  back in a pack, so the loss landed on the workflow packs exist for. Both now have real strategies
  (a 3-way union by id, and a per-key 3-way), and any field the merger does not name travels through a
  plain 3-way rather than vanishing.

  **An unresolved merge cannot reach an export or a pack.** patter-merge.md §3.6 says so and only
  `validate` enforced it. Pack was the worse of the two: it carries shards and not sidecars, so sending
  one handed the recipient conflicted values resolved provisionally to our side with nothing to say
  they were in dispute. `sidecarIssues` now lives beside the rule in `merge.ts` and all three callers
  use it.

  `AUTHORING_HANDLED` is exported so a test can hold the merger's own key list against the model's
  interfaces - the direction that found a live stale-key bug on the Storyletter side when they took
  this shape.

  **A malformed shard on the return leg says which shard and which side.** `runUnpackMerge` parsed
  ours, theirs and base bare, so one unreadable file aborted the whole return leg with a raw parse
  error naming neither.

  Separately, two answers to "which files on disk are the project?" (from-storylets/
  load-issues-and-the-strict-loader). `walkFiles` skips dot-entries, so a shard in an editor backup or
  a vendored checkout is no longer collected as real content - it could previously collide with a live
  scene id and fail the load outright. And `runValidate` gains `orphans`: a valid shard outside the
  project's layout was not malformed, merely not in the project, and nothing anywhere said so. The CLI
  reports it as `[not-in-project]`.

## 0.3.6

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
  - @patterkit/compiler@0.2.4
  - @patterkit/runtime@0.5.1

## 0.3.5

### Patch Changes

- c3ca0c2: Two readable-script PDF fixes. An element starting in the last sliver of a page no longer leaves its
  snippet edge and speaker cue behind on the wrong page when its body flows over (the reported "weird
  overlapping lines on the left" and a stranded speaker name at a page's foot); a widow guard, cue-first
  drawing and a page-turn clamp close all three symptoms. And `scriptToPdf` no longer asks PDFKit to
  load its default Helvetica, which read an AFM file via `__dirname` and crashed the self-contained CLI
  bundle on every `export-script`; every glyph comes from the embedded faces. A game event in the
  script now carries ALL its gameData fields (a fourth and fifth were silently dropped), and a long
  field list wraps as a mono block instead of truncating (#48).

## 0.3.4

### Patch Changes

- a89d0b8: Every sheet the .xlsx renderers produce (report, voice script, localisation) now freezes its header
  row, so it stays on screen while you scroll a long export. Presentation only: `xlsxToCatalog` reads
  columns positionally and is unaffected.

## 0.3.3

### Patch Changes

- dca5b44: The inlined playable-runtime snapshot is refreshed for the cast APIs (`getCast`, `castForScene`,
  `castForBlock`), so a playable HTML export ships a runtime that has them.

## 0.3.2

### Patch Changes

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

- Updated dependencies [614eaa8]
  - @patterkit/core@0.2.0
  - @patterkit/model@0.3.0
  - @patterkit/compiler@0.2.3
  - @patterkit/runtime@0.4.1

## 0.3.1

### Patch Changes

- 2d596c0: The inlined playable-runtime snapshot is refreshed for `describeBundle`

  `runExportHtml` inlines a minified copy of `@patterkit/runtime`, so a runtime change is also a change to what this package ships. Without a release, a playable HTML export keeps embedding the previous runtime while the repo says otherwise.

## 0.3.0

### Minor Changes

- f5645f5: `unpack --merge` checks that the returned pack, the base pack and the target project are the same project

  Every `.patterpack` manifest has always carried `project.id`, and nothing read it. Pointing a merge at an unrelated project's pack therefore merged by id, matched almost nothing, and produced a mountain of conflicts that read as though the other author had rewritten the whole project.

  `runUnpackMerge` now returns a `ProvenanceCheck` (`{ returned?, base?, target?, ok }`) comparing the three ids, and `patter unpack --merge` prints a warning before its writes when they disagree. It **warns and never refuses**: an id can legitimately differ across a fork or a reissue. A document with no readable manifest still merges, since an id that cannot be read cannot disagree.

  This is the weak half of pack provenance. It cannot detect the wrong _revision_ of the right project, which needs a content hash the format does not yet carry.

## 0.2.3

### Patch Changes

- d488e49: Refresh the inlined Patterplay runtime blob (`playable-runtime.ts`) so a published playable HTML page carries the current runtime, including the new host navigation API (`goto` / `runFlow` / `advanceToStop`). The blob is a snapshot of the runtime's built `patterplay.min.js`, so it drifts whenever the runtime changes and has to be regenerated after a build.

  Note the JS runtime itself is deliberately NOT versioned by Changesets - `npm run bump:play` is its version authority, and `changeset publish` picks it up because its local version is ahead of the registry.

- 4cbaa5a: `runInit`'s starter line no longer tells the writer to edit a file and run a command. The scaffolded scene's one text beat is story content the writer replaces, but it read `Welcome to <name>. Edit scenes/start.patterflow, then run: patter play` - meaningless to someone who created the project in Patterpad and is typing straight into the editor, and redundant for `patter init`, which already prints its own next step on the terminal. It now reads `Welcome to <name>. This is the first line of your story - replace it with your own.`, which suits every front-end.

## 0.2.2

### Patch Changes

- Updated dependencies [b14eadf]
  - @patterkit/model@0.2.1
  - @patterkit/compiler@0.2.2
  - @patterkit/core@0.1.5

## 0.2.1

### Patch Changes

- 087ceca: `applyLoc` now counts only strings whose translation actually changed in `stats.updated`, instead of every non-empty string in the imported catalog. Re-importing an unedited file reports `0 updated` rather than the full line count.
- Updated dependencies [178967e]
  - @patterkit/core@0.1.4
  - @patterkit/compiler@0.2.1

## 0.2.0

### Minor Changes

- 34429f0: Add `CastMember.gender` (a new `GrammaticalGender` type: `male` / `female` / `neuter`, absent = not specified) and carry it into the localisation handoff as translator context, so gendered languages can inflect a character's own lines: a `Gender` column in the Excel export, a `#. Gender: <g>` extracted comment in PO/POT, and `context.gender` on each JSON `LocEntry`. It is export-only (regenerated from the cast each export, never read back by `applyLoc`) and the compiler strips it from the runtime bundle alongside `notes`.
- c61c146: Add a per-line "needs re-record" flag (#227). `AuthoringFile.rerecord` (beat id -> true) marks a dialogue take that exists but must be redone; the new reserved `RERECORD_STATUS` masks the line's recording status everywhere it is read, so a "recorded" line still surfaces as work. `mergeAuthoring` now returns the `rerecord` set and ops exposes `effectiveRecording()`, which the recording script (`runVoiceScript`), the production report (`runReport`, with its own re-record bucket), and status browse (`runStatusBrowse`, filterable by `rerecord`) all resolve through. Authoring-only; never compiled into a bundle.

### Patch Changes

- Updated dependencies [34429f0]
- Updated dependencies [34429f0]
- Updated dependencies [c61c146]
  - @patterkit/compiler@0.2.0
  - @patterkit/model@0.2.0
  - @patterkit/core@0.1.3
  - @patterkit/runtime@0.2.1

## 0.1.3

### Patch Changes

- 001c1d5: Regenerate the inlined runtime blob so playable-HTML exports run the current runtime. It had drifted from before Best match (`specificity`) landed, so an exported playable page ran Best-match groups as plain sequential. CI now fails if the committed blob is stale.
- Updated dependencies [65f6ccb]
  - @patterkit/model@0.1.2
  - @patterkit/compiler@0.1.2
  - @patterkit/core@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [00bc37f]
  - @patterkit/model@0.1.1
  - @patterkit/compiler@0.1.1
  - @patterkit/core@0.1.1

## 0.1.1

### Patch Changes

- 34bdd67: Pack: `.patterpack` documents are now truly byte-reproducible. JSZip stamps
  implicit folder entries with the wall clock regardless of the per-file `date`
  option, so two packs of unchanged source could differ when they straddled a
  DOS-time 2-second boundary; folder entries are no longer created.
