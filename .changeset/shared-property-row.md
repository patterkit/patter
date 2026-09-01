---
"@patterkit/play-helpers": minor
---

BREAKING: a property row's address is `path`, not `ref`, and the row now carries `name` and `writable`.

`listProperties()` returns the row type from `@wildwinter/scoperegistry` itself,
rather than a local interface redeclaring it. The inspector reads `row.path`
where it read `row.ref`.

This shipped briefly as a `PropertyView` that extended the shared row to add
`path`. `path` is on the shared row now - both product families had forked it to
add exactly that field - so `PropertyView` was a second name for one type, and it
is gone rather than left as an alias. `PropertyRow` is re-exported from
`@patterkit/runtime`, so naming a row needs no dependency on the kernel.

The two are the same row: `path` is the addressable reference `getProperty` and
`setProperty` already take (`@patter.gold`), which is exactly what `ref` held.
What is new is `name`, the bare declared name, and `writable`, which the local
interface dropped so an inspector could not tell a read-only property from a
writable one.

The fork is why this mattered. The shared type lacked a quality's `stages`,
which was added here instead, so the Storylet Engine - reading the same expr
property model through the same registry - edited a quality as free text on
every platform it ships. One row type, one place to add the next field.
