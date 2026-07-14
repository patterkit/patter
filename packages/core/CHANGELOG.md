# @patterkit/core

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
