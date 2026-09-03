---
"@patterkit/ops": patch
"@patterkit/cli": patch
---

A Patter file outside the project's folders is reported by name: the message gives its path relative to the project and the folder this project reads that kind from (`Move it under scenes/, or delete it.`), and a second project file names the one that is read. The CLI prints that message as is.
