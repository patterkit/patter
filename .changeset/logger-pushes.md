---
"@patterkit/play-helpers": minor
---

The state logger watches the property bags instead of diffing save snapshots.

`createStateLogger` is an adapter over the state logger in
`@wildwinter/scoperegistry` now - the same core the Storylet Engine has always
used. A property write is logged when it LANDS, on the bag's audit hook, rather
than at the next `capture()`. The visit counts live in no bag, so those are still
diffed, which is all this logger used to do for everything.

What that buys, and why it was worth changing: a diff can only ever report the
NET change between two captures. A value that changed and changed back was
invisible, and every write was reported late.

`capture()` returns the same changes and the line format is unchanged. The
returned logger gains `dispose()`, which unhooks the auditors - call it when you
are done with a logger, or it and the bags keep each other alive.

`StateChange`, `StateSnapshot` and `diffState` are the kernel's types now, and
re-exported here, so an import that named them from `@patterkit/play-helpers`
still resolves. `StateValue` is an alias of the kernel's `ScalarValue`.

Needs `@patterkit/runtime` 0.10.0 or later, whose `Engine.listBags()` and
`Flow.listBags()` are what the logger mounts.
