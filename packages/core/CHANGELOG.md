# @patterkit/core

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
