---
"@patterkit/dialect": patch
"@patterkit/compiler": patch
"@patterkit/play-helpers": patch
"@patterkit/ops": patch
---

`@wildwinter/scoperegistry` is now a peer dependency, as it is of `@patterkit/runtime`: a game and every engine in it share one registry, so an install must hold exactly one copy. npm installs it for you; if two packages ever need versions that cannot be one copy, the install stops and says so instead of adding a second.
