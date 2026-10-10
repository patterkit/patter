---
"@patterkit/model": patch
"@patterkit/core": patch
"@patterkit/ops": patch
---

Speaker qualifiers and line padding, tidied after review.

- `@patterkit/model`: `HandoffLine.qualifierName`, the qualifier's name as the editable script's cue printed it. Optional, so older handoff records still load.
- `@patterkit/core`: `validateProject` warns on a qualifier on a line with no speaker (`qualifier-without-speaker`), and on a negative pause on an option's prompt when the option plays no beat (`prompt-pad-without-beat`); it reports a qualifier list that isn't a list, or holds an entry that isn't a qualifier, as `invalid-qualifier` instead of throwing.
- `@patterkit/ops`: reimporting an editable script reads each cue against the qualifier name it was printed with, so renaming a qualifier in settings after export no longer reads an untouched cue as a change. The project merge merges `qualifiers` per `gameId`, so two branches each adding one both land.
