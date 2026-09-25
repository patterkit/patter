---
"@patterkit/cli": minor
"@patterkit/ops": minor
---

`@patterkit/cli`: `share-scopes [path] [--at dir]`, the terminal's version of Patterpad's File > Share Scopes with Other Tools. It makes the game's `game-scopes/` folder (in `--at`, else at the version-control root above the project) with `patter.scopes.json` and a `game.scopes.json` holding the project's World properties, names a folder the project wouldn't find by looking up in its `gameScopes`, and refuses a project that already shares its scopes.

`@patterkit/ops`: `planShareScopes` joins a folder another tool already made instead of replacing its `game.scopes.json`: every scope the file holds is kept, and only the project's game scopes it lacks are added. It returns `{ error }`, and plans nothing, when that file won't parse.
