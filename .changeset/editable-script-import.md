---
"@patterkit/ops": minor
---

`planEditableImport` brings a returned editable script back as Suggestions and Comments, checked against the handoff record: changed lines become suggestions credited to their tracked-change authors (a cut when a box was emptied, a speaker or direction change from the cue cell), the editor's comments and inline `[[notes]]` become comment threads on their line or node, and anything that can't be a suggestion (changed `{@…}` placeholders, a copied box, text typed outside the boxes, an edited context row) becomes a comment quoting the editor's words. Damaged markers are matched by position, moved lines are noted, a file with over a quarter of its lines missing is refused, a re-import replaces the handoff's still-open suggestions, and `direct` accepts the clean ones on the way in. Pure: it returns the writes and a report.
