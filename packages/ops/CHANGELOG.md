# @patterkit/ops

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
