---
"@patterkit/ops": patch
"@patterkit/cli": minor
---

The readable-script PDF fonts now come from their upstream npm packages (Fontsource for Newsreader, Inter and Noto; IBM's own release of Plex Mono) instead of a copy inlined into ops, so ops drops from 2.9 MB to 0.4 MB and the fonts arrive with their own licences. Greek, Cyrillic, arrows and maths fall back to Noto Sans and Noto Sans Math instead of DejaVu Sans. The npm CLI is now a thin build (43 KB, down from 8.4 MB) whose dependencies install from npm beside it; the standalone binaries are still one self-contained file each, fonts included. New `patter licences` (also `licenses`) prints patter's own licence, the licence of every font the PDF export embeds, and, in a standalone binary, the licence and copyright notice of every library compiled into it.
