---
"@patterkit/ops": patch
---

Every sheet the .xlsx renderers produce (report, voice script, localisation) now freezes its header
row, so it stays on screen while you scroll a long export. Presentation only: `xlsxToCatalog` reads
columns positionally and is unaffected.
