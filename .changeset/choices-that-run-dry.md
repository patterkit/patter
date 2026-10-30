---
"@patterkit/core": minor
"@patterkit/model": patch
"@patterkit/ops": patch
"@patterkit/cli": patch
"@patterkit/conformance": minor
---

A choice that can run dry is judged by what follows it. `validateProject` now follows jumps and calls across blocks and scenes to find a choice that can be played again (a hub reached round a hall, say), and leaves out one inside a once-only option, which plays at most once. Where nothing follows a choice that can run dry, so the dialogue would end there, it's the new warning `choice-ends-dry`; where play carries on after it, `choice-can-empty` is now a note, the new severity `info`, which never counts as an error or a warning (`patter validate` prints it as `note:`). The model's flow cursor gains an optional `ranDry`, and the conformance corpus is version 10: the runtime's `end` step reason and the `dry-choice` problem. The Coverage Test lists a choice that ran dry once, as a dry choice, not again as a content error.
