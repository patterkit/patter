---
"@patterkit/core": minor
"@patterkit/ops": patch
"@patterkit/model": minor
---

Property names are held to the grammar of the expression language that resolves them.

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
