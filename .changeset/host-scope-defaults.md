---
"@patterkit/compiler": minor
"@patterkit/play-helpers": patch
---

A host scope's declarations (`@world`) ship in the bundle with their defaults resolved, as every other declaration's are. Nothing plays differently: a bound resolver still supplies the game's values, and the default is only the fallback the runtime self-backs with.
