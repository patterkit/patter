---
"@patterkit/ops": patch
"@patterkit/cli": patch
"@patterkit/core": patch
"@patterkit/compiler": patch
---

Version-control setup and `patter mergetool` now come from `@wildwinter/toolkit` 0.2.3's shared `vcs` module, the same copy Storylets uses. Every pattern, attribute, and command in the generated files is unchanged; their wording is tidied and their rows are column-aligned. `mergetool` keeps its order and exit codes.
