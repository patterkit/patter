---
"@patterkit/core": patch
"@patterkit/ops": patch
---

The readable script (Publish ▸ Readable Script, .pdf and .docx) names the block a condition refers to, instead of printing its id: `‹ if not seen(Intro) ›`, the way the editor has always shown it. `visits()` / `seen()` take a node id and Patterpad writes it as a bareword, but the export's copy of the read-out-loud rule only matched a QUOTED id, so real scripts went out reading `‹ if not seen(blk_lcd858q2) ›`.

The rule now lives once, in `@patterkit/core` as `humanizeNodeRefs`, and both the editor's condition tag and the script export take it from there. Reported by jlafos in #64.
