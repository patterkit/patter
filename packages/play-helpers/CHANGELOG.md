# @patterkit/play-helpers

## 0.2.0

### Minor Changes

- e69a249: Patterplay JS: ship a self-contained `patterplay.min.js` drop-in (window.Patterplay)
  alongside the ESM/CJS library, and add the new `@patterkit/play-helpers` companion
  (save/load envelope, runtime property setters, external-locale loader, state logger).
  Runtime: a string missing in the active locale now falls back to the default-locale
  source text, flagged `<Untranslated: {id}> {source}`, instead of leaking the raw id.

### Patch Changes

- Updated dependencies [e69a249]
  - @patterkit/runtime@0.2.0
