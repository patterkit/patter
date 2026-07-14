# @patterkit/model

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
