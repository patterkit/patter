---
"@patterkit/play-helpers": minor
---

The runner's `ended` event hands its handler the reason the flow ended, as the `end` step says: `"ended"`, or `"ran-dry"` when a choice had nothing left to offer and nothing came after it. A handler that takes no argument works as before. The same in the Unity, Unreal, and Godot runners.
