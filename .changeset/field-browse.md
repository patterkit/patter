---
"@patterkit/ops": minor
---

`runFieldBrowse(loaded, query, focus?)` finds every node by a gameData field's value (`mood`, `mood = tense`, `mood != calm`), read by `@wildwinter/toolkit`'s shared field matcher, so Patterpad's and Storyletter's Field tabs read a query the same way. The value tested is the one that holds: the node's own, else the field's declared default. Each row carries a `field` (name, type, the value as text, and `isDefault`). `listGameDataFields(loaded)` lists the declared fields by name with the node kinds that declare them.
