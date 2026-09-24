---
"@patterkit/ops": minor
"@patterkit/cli": minor
---

Packs carry the game's shared scopes (patterkit/design/shared-scopes.md, "Packs").

`@patterkit/ops`: where the project has a game scopes folder (found as the loaders find it, `gameScopes` override included), `runPack` carries every `*.scopes.json` in it as `game-scopes/<name>` entries, as the files are on disk, and the manifest (`DocumentManifest`) gains an optional sorted `gameScopes` list of their names. A project with no folder packs to the same bytes as before. `runUnpack` now returns `{ shards, scopes }` (it returned the shard writes as an array): `scopes` plans the snapshot into `<targetDir>/game-scopes/`, where the unpacked project finds it first, and is empty for a pack without one. `runUnpackMerge` never writes a returned pack's snapshot; when the project has a game scopes folder and the returned project file's copy of the game's scopes differs from the base pack's (the recipient edited World properties), it adds a write of the scopes they changed to `game.scopes.json`, keeping the file's other scopes, and reports it as `gameScopes: { path }` (with `error`, and no write, when that file won't parse). New helpers: `gameScopesSnapshot`, `planReturnedWorld`, and the `UnpackResult` type.

`@patterkit/cli`: `unpack` writes and lists a pack's game scopes snapshot, and `unpack --merge` prints a `game scopes:` line when it writes the recipient's World edit to `game.scopes.json` (or a warning when that file won't parse).
