---
"@patterkit/cli": patch
---

`export-script` works again in the published CLI: the bundled PDFKit tried to load its default font
from disk via `__dirname`, which an ESM bundle does not define, so every PDF export failed with
"__dirname is not defined". Fixed in @patterkit/ops (no default font is loaded at all) and rebundled;
a bundle smoke test now runs `dist/cli.js` end to end so a bundle-only fault cannot ship green again.
