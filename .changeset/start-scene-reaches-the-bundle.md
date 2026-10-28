---
"@patterkit/model": minor
"@patterkit/compiler": minor
"@patterkit/core": minor
"@patterkit/ops": minor
---

The project's start scene reaches the game (the hands-on review of October 2026). The bundle gains `start` (`{ scene, block? }`), written by the compiler when the project's start names a scene, and block, the bundle has, and folded into both hashes only when present, so bundles without one are unchanged. `validate` warns `no-start` when a project with scenes sets none, and `dangling-start` when it names a scene or block that has gone: either way a game that doesn't name a scene starts at the first one. `patter init`, and so Patterpad's New Project, sets the start to its one scene, and the playable HTML export opens at the bundle's start, block included.
