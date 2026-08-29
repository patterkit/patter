---
"@patterkit/ops": minor
---

Close four holes in the merge path (from-storylets/merge-holes-worth-checking).

**An authoring merge no longer drops fields.** `mergeAuthoring` built its result from a fixed key
list, so `suggestions` and `rerecord` - added to the model after it was written - were discarded
outright, from both sides, with no conflict and no warning. Suggestions are what a reviewer sends
back in a pack, so the loss landed on the workflow packs exist for. Both now have real strategies
(a 3-way union by id, and a per-key 3-way), and any field the merger does not name travels through a
plain 3-way rather than vanishing.

**An unresolved merge cannot reach an export or a pack.** patter-merge.md §3.6 says so and only
`validate` enforced it. Pack was the worse of the two: it carries shards and not sidecars, so sending
one handed the recipient conflicted values resolved provisionally to our side with nothing to say
they were in dispute. `sidecarIssues` now lives beside the rule in `merge.ts` and all three callers
use it.

`AUTHORING_HANDLED` is exported so a test can hold the merger's own key list against the model's
interfaces - the direction that found a live stale-key bug on the Storyletter side when they took
this shape.

**A malformed shard on the return leg says which shard and which side.** `runUnpackMerge` parsed
ours, theirs and base bare, so one unreadable file aborted the whole return leg with a raw parse
error naming neither.
