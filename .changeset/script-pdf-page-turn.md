---
"@patterkit/ops": patch
---

Two readable-script PDF fixes. An element starting in the last sliver of a page no longer leaves its
snippet edge and speaker cue behind on the wrong page when its body flows over (the reported "weird
overlapping lines on the left" and a stranded speaker name at a page's foot); a widow guard, cue-first
drawing and a page-turn clamp close all three symptoms. And `scriptToPdf` no longer asks PDFKit to
load its default Helvetica, which read an AFM file via `__dirname` and crashed the self-contained CLI
bundle on every `export-script`; every glyph comes from the embedded faces. A game event in the
script now carries ALL its gameData fields (a fourth and fifth were silently dropped), and a long
field list wraps as a mono block instead of truncating (#48).
