---
"@patterkit/cli": minor
---

`patter play` exits 1 when a condition or effect fails on the way, as well as when the playthrough does not reach the end, since the engine now plays on past such a failure instead of stopping. The transcript marks each one with `!`. `patter coverage` lists them.
