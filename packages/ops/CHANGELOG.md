# @patterkit/ops

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
