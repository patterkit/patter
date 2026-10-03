---
"@patterkit/ops": minor
---

`readEditableDocx` reads a returned editable script: every box by its marker (recovered from a tracked deletion if need be), each box's words with tracked changes both accepted and rejected (so a tracked edit is told from an untracked one, and every change keeps its author), bold and italic as markup, the comments with their authors and replies, and the handoff id from the page header. Boxes are still found when a tool has merged neighbouring tables. Adds `@xmldom/xmldom` as a dependency.
