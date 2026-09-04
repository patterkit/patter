# @patterkit/ops

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
