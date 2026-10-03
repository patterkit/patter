---
"@patterkit/ops": minor
---

`runScriptDoc` elements now carry the id of the scene, block, node, or beat they show (an option also its node, a jump its target), and the function takes options: `scenes` to export a range, and `notes` to include documentation notes for a channel, or all classed notes. The readable script asks for neither, so its output is unchanged.
