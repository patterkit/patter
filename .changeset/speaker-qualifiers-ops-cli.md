---
"@patterkit/ops": minor
"@patterkit/cli": minor
---

Speaker qualifiers in the exports. The screenplay (PDF and DOCX), the playable HTML, and `patter play` print a qualified cue as `TAM (O.S.)`; the voice script gains a Qualifier column, with lines still under the one character; localisation exports carry a line's qualifier as read-only context and the qualifier names as project-level strings; and the editable script handoff sends the qualifier in the cue and reads a changed one back as a suggestion. `patter suggestions` lists a qualifier change. `@patterkit/ops` exports `cueLabel` and `qualifierNamer`.
