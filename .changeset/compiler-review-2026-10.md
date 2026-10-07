---
"@patterkit/compiler": patch
---

`validateInterpolation` looks each string up once per language rather than once per shard: 5 ms rather than 182 ms on a 100-scene project.
