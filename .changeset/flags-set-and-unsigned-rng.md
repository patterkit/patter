---
"@patterkit/ops": minor
---

The bundled playable-runtime carries two behaviour changes.

Flags compare as a set: `==` and `!=` ignore order, so `["red","blue"]` equals
`["blue","red"]`, compared as multisets so a duplicate still counts. Order used
to be significant, which meant `set_flags(@f, +red)` then `+blue` compared
UNEQUAL to the same two flags added the other way round, a difference no author
can see and none intends. A condition that was silently false on a reordered
flags value now passes.

The mulberry32 state is saved unsigned, where it was previously stored through
`| 0` and so went negative in over half of all saves. Existing saves still
load; new ones are readable by every Patterplay port.

Both originate in @patterkit/runtime, which ships with the Patterplay lockstep
set rather than through a changeset. This entry covers the blob ops bundles.
