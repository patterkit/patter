---
"@patterkit/play-helpers": minor
---

BREAKING: a property row's address is `path`, not `ref`, and the row now carries `name` and `writable`.

`listProperties()` returns `PropertyView` (was `PropertyRow`), which extends the
row type from `@wildwinter/scoperegistry` rather than redeclaring it here. The
inspector reads `row.path` where it read `row.ref`.

The two are the same row: `path` is the addressable reference `getProperty` and
`setProperty` already take (`@patter.gold`), which is exactly what `ref` held.
What is new is `name`, the bare declared name, and `writable`, which the local
interface dropped so an inspector could not tell a read-only property from a
writable one.

The fork is why this mattered. The shared type lacked a quality's `stages`,
which was added here instead, so the Storylet Engine - reading the same expr
property model through the same registry - edited a quality as free text on
every platform it ships. One row type, one place to add the next field.
