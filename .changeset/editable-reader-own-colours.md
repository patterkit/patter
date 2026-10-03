---
"@patterkit/ops": patch
---

Reading a returned editable script no longer reports "formatting was dropped" for the script's own colours and box fill, which Google Docs copies onto every run when it saves a document; a colour, highlight, or underline the editor added is still noticed.
