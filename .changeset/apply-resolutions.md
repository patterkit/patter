---
"@patterkit/ops": minor
---

**Settle a merge's clashes from the shard.** `applyResolutions(shardText, decisions)` takes a shard carrying
the `unresolved` mark and a decision per clash path, and answers the shard's new canonical text: `"ours"`
keeps the value the shard holds and clears the entry, `"theirs"` writes their side at the path (or removes
what's there, where theirs had none) and clears it, and `"resolved"` clears it only, for a place edited by
hand. With no entries left, the `unresolved` key goes. A path the mark doesn't hold, or `"theirs"` for a
clash that isn't one value (`moved`, `structural`, or a declaration list's `:order`), throws
`ResolutionError`; `isSettableClash` says which can take theirs. Alongside it: `unresolvedClashes(shard)`
reads a shard's entries, `findMarkedShards(root)` finds every marked shard in a project with its
`.patterconflict` sidecar (the same walk validate makes), and `clashPathSegments` and `valueAtClashPath` read
the merge's path grammar. Patterpad's clash resolver is built on these. The toolkit moves to 0.4.
