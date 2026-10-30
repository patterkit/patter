---
"@patterkit/play-helpers": minor
---

The runner's `ended` event hands its handler a `FlowEndReason`, the runtime's new name for what was `EndReason` (`"ended"` or `"ran-dry"`). Only code that names the type needs the change.
