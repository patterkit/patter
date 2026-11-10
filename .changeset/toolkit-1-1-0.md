---
"@patterkit/core": patch
"@patterkit/compiler": patch
"@patterkit/model": patch
"@patterkit/ops": patch
"@patterkit/cli": patch
---

**Extensions can start a group of fields closed.** The toolkit moves to ^1.1.0, so a manifest's `groups` table is
checked and read rather than warned of as a key it doesn't know.
