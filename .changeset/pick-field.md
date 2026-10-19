---
"@patterkit/compiler": minor
"@patterkit/ops": minor
"@patterkit/cli": patch
"@patterkit/core": patch
---

Patter extensions can declare a `pick` field (`@wildwinter/toolkit` 0.2.5): one choice from fixed words, the nodes of a reference kind such as the cast, and lists of text on the extension's own project node. The compiler checks each value against them, from the extension's project entry wherever its shard sits: a value no source holds is an error (`not-a-choice`), one two sources hold a warning (`pick-ambiguous`), and each name two sources hold is reported once for the project (`pick-clash`), so `patter validate` catches a misspelt name. A cast rename rewrites the pick values naming the member (`renameCastKeys`), as it rewrites references; a renamed entry of a project list isn't followed, so a value naming the old entry is reported missing.
