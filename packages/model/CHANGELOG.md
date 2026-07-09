# @patterkit/model

## 0.1.2

### Patch Changes

- 65f6ccb: Add the `autoRebuild` field to `ProjectFile` (Patterpad's opt-in auto-recompile setting). Editor-only, never reaches the bundle; this just lets the published model types describe it.

## 0.1.1

### Patch Changes

- 00bc37f: Add the `specificity` value to `SelectorOrder` (the Best match sequence selector). Type-only: the Best-match runtime behaviour ships in `@patterkit/runtime`, and the compiler carries the mode verbatim; this just lets the published model types describe it.
