# @patterkit/cli

## 0.5.1

### Patch Changes

- Updated dependencies [e4e7921]
  - @patterkit/ops@0.10.0

## 0.5.0

### Minor Changes

- 18da398: `@patterkit/cli`: `share-scopes [path] [--at dir]`, the terminal's version of Patterpad's File > Share Scopes with Other Tools. It makes the game's `game-scopes/` folder (in `--at`, else at the version-control root above the project) with `patter.scopes.json` and a `game.scopes.json` holding the project's World properties, names a folder the project wouldn't find by looking up in its `gameScopes`, and refuses a project that already shares its scopes.

  `@patterkit/ops`: `planShareScopes` joins a folder another tool already made instead of replacing its `game.scopes.json`: every scope the file holds is kept, and only the project's game scopes it lacks are added. It returns `{ error }`, and plans nothing, when that file won't parse.

### Patch Changes

- Updated dependencies [18da398]
  - @patterkit/ops@0.9.0

## 0.4.0

### Minor Changes

- 40befdb: Packs carry the game's shared scopes (patterkit/design/shared-scopes.md, "Packs").

  `@patterkit/ops`: where the project has a game scopes folder (found as the loaders find it, `gameScopes` override included), `runPack` carries every `*.scopes.json` in it as `game-scopes/<name>` entries, as the files are on disk, and the manifest (`DocumentManifest`) gains an optional sorted `gameScopes` list of their names. A project with no folder packs to the same bytes as before. `runUnpack` now returns `{ shards, scopes }` (it returned the shard writes as an array): `scopes` plans the snapshot into `<targetDir>/game-scopes/`, where the unpacked project finds it first, and is empty for a pack without one. `runUnpackMerge` never writes a returned pack's snapshot; when the project has a game scopes folder and the returned project file's copy of the game's scopes differs from the base pack's (the recipient edited World properties), it adds a write of the scopes they changed to `game.scopes.json`, keeping the file's other scopes, and reports it as `gameScopes: { path }` (with `error`, and no write, when that file won't parse). New helpers: `gameScopesSnapshot`, `planReturnedWorld`, and the `UnpackResult` type.

  `@patterkit/cli`: `unpack` writes and lists a pack's game scopes snapshot, and `unpack --merge` prints a `game scopes:` line when it writes the recipient's World edit to `game.scopes.json` (or a warning when that file won't parse).

- 40befdb: Shared game scopes (requires `@wildwinter/scoperegistry` ^0.8.0). A game can keep one `game-scopes/` folder where each editing tool writes the properties it declares and reads the others'.

  `@patterkit/model`: `ProjectFile.gameScopes`, a path (relative to the project file) naming the folder when the walk-up from the project would not find it.

  `@patterkit/compiler`: `validateConditions` and `validateInterpolation` take `gameScopes` (the merged folder) and check every scope in it the host spec doesn't hold, with warnings only: an undeclared name (worded by `referenceNote`), a type mismatch, or a write to a read-only property. `exportBundle` takes `gameScopes` too: `game.scopes.json` wins over the project's copy of a host scope, its `@world` is baked into `scopeRegistry` even when the project doesn't declare it, and every other scope in the folder compiles as another engine's does, named in `externalScopes` and never baked in. New exports: `projectScopes`, `externalGameScopes`, `PATTER_SCOPE`, and `EXTERNAL_SCOPES` (re-exported from the dialect).

  `@patterkit/ops`: the loaders discover the folder (`LoadedProject.gameScopes`, `gameScopesMissing`), and export, validate, play, coverage, and reachability pass it on. `runValidate` gains `gameScopes` issues (a file that won't parse, a token two files claim, and a missing override are errors; `patter.scopes.json` out of date and the project's copy of a game scope differing are warnings), and `ok` now counts only errors among condition and interpolation issues. `runPlay` and coverage stand other engines in from the folder (`previewRegistry`) when the bundle names them. New helpers for editors: `patterScopesFile`, `patterScopesWrite`, `planWorldSave`, `planShareScopes`, `worldSettingsScopes`, `defaultGameScopesDir`, `gameScopesCatalogue`, `gameScopeTokens`.

  `@patterkit/cli`: `export` writes `game-scopes/patter.scopes.json` when there is a folder and the file would change; `validate` prints the folder's issues as `[game-scopes]`, and prints warnings as such without failing; `play` and `coverage` run content naming another engine's scope where the folder declares it.

### Patch Changes

- Updated dependencies [40befdb]
- Updated dependencies [40befdb]
  - @patterkit/ops@0.8.0
  - @patterkit/core@0.2.6

## 0.3.9

### Patch Changes

- Updated dependencies [b91b7e1]
  - @patterkit/ops@0.7.7
  - @patterkit/core@0.2.5

## 0.3.8

### Patch Changes

- Updated dependencies [df4cd3a]
  - @patterkit/core@0.2.4
  - @patterkit/ops@0.7.6

## 0.3.7

### Patch Changes

- Updated dependencies [2e81c41]
  - @patterkit/ops@0.7.5

## 0.3.6

### Patch Changes

- Updated dependencies [38dcf54]
  - @patterkit/ops@0.7.4

## 0.3.5

### Patch Changes

- 14a0ccc: A Patter file outside the project's folders is reported by name: the message gives its path relative to the project and the folder this project reads that kind from (`Move it under scenes/, or delete it.`), and a second project file names the one that is read. The CLI prints that message as is.
- Updated dependencies [27d92dc]
- Updated dependencies [14a0ccc]
  - @patterkit/ops@0.7.3

## 0.3.4

### Patch Changes

- Updated dependencies [44e9696]
  - @patterkit/ops@0.7.2
  - @patterkit/core@0.2.3

## 0.3.3

### Patch Changes

- Updated dependencies [a958b9e]
  - @patterkit/ops@0.7.1

## 0.3.2

### Patch Changes

- Updated dependencies [bd33b5c]
  - @patterkit/ops@0.7.0

## 0.3.1

### Patch Changes

- Updated dependencies [2a16584]
- Updated dependencies [2a16584]
  - @patterkit/ops@0.6.0
  - @patterkit/core@0.2.2

## 0.3.0

### Minor Changes

- 156ea39: `patter --version` (also `-v`, `patter version`) prints the CLI's version.

  The CLI ships as a self-contained per-platform binary: no `package.json` beside it, no npm that installed it, and a filename that is whatever the downloader called it. The tool was the only thing that could answer "which build is this?" and it printed the usage text instead, which reads as a refusal. The number is inlined from the manifest at build time rather than kept in a constant, and both shipping paths (tsup and Bun `--compile`) were run to confirm it, since a JSON import a bundler fails to inline is a runtime `undefined` rather than a build error. Reported from the Storylet Studio side.

### Patch Changes

- c37067b: Coverage: a never-reached beat now says when its gate is written only by content that was itself never reached.

  `needsInput` asks whether anything writes a gate and stops there, so a gate written only by a beat nobody reaches read as perfectly wired. `CoverageBeat.blockedBy` names the gate and the writers, turning two silent beats with one cause into a single question. Gates are keyed by individual flag (`@world.mood:armed`) rather than by property, since a property half the story writes always looks fed. The check refuses to speak where it cannot refute: an unwitnessed writer, or a property assigned wholesale, drops out rather than being guessed at.

- 7004f48: `validate` now reports conditions that provably can never hold.

  A snippet gated on `@connected && !@seen`, where the only writer of `@connected` is itself gated on `@seen` and nothing sets `@seen` back, is unsatisfiable. `ValidateResult.reachability` names the chain, and `patter validate` prints it as `[unreachable]`. The analysis covers monotonic latches only (a boolean only ever written `true`, a flag only ever `+set`); anything written another way, host-driven, `temporary`, or already true by default drops out rather than being guessed at, because a false "this can never happen" is worse than silence. Warnings, deliberately outside `ok`: they never fail a build. Adapted from a design contributed by the Storylet Studio side.

- Updated dependencies [c37067b]
- Updated dependencies [7004f48]
  - @patterkit/ops@0.5.0

## 0.2.7

### Patch Changes

- 144311e: Close four holes in the merge path (from-storylets/merge-holes-worth-checking).

  **An authoring merge no longer drops fields.** `mergeAuthoring` built its result from a fixed key
  list, so `suggestions` and `rerecord` - added to the model after it was written - were discarded
  outright, from both sides, with no conflict and no warning. Suggestions are what a reviewer sends
  back in a pack, so the loss landed on the workflow packs exist for. Both now have real strategies
  (a 3-way union by id, and a per-key 3-way), and any field the merger does not name travels through a
  plain 3-way rather than vanishing.

  **An unresolved merge cannot reach an export or a pack.** patter-merge.md §3.6 says so and only
  `validate` enforced it. Pack was the worse of the two: it carries shards and not sidecars, so sending
  one handed the recipient conflicted values resolved provisionally to our side with nothing to say
  they were in dispute. `sidecarIssues` now lives beside the rule in `merge.ts` and all three callers
  use it.

  `AUTHORING_HANDLED` is exported so a test can hold the merger's own key list against the model's
  interfaces - the direction that found a live stale-key bug on the Storyletter side when they took
  this shape.

  **A malformed shard on the return leg says which shard and which side.** `runUnpackMerge` parsed
  ours, theirs and base bare, so one unreadable file aborted the whole return leg with a raw parse
  error naming neither.

  Separately, two answers to "which files on disk are the project?" (from-storylets/
  load-issues-and-the-strict-loader). `walkFiles` skips dot-entries, so a shard in an editor backup or
  a vendored checkout is no longer collected as real content - it could previously collide with a live
  scene id and fail the load outright. And `runValidate` gains `orphans`: a valid shard outside the
  project's layout was not malformed, merely not in the project, and nothing anywhere said so. The CLI
  reports it as `[not-in-project]`.

- Updated dependencies [144311e]
  - @patterkit/ops@0.4.0

## 0.2.6

### Patch Changes

- Updated dependencies [f97f6eb]
  - @patterkit/core@0.2.1
  - @patterkit/ops@0.3.6

## 0.2.5

### Patch Changes

- c3ca0c2: `export-script` works again in the published CLI: the bundled PDFKit tried to load its default font
  from disk via `__dirname`, which an ESM bundle does not define, so every PDF export failed with
  "\_\_dirname is not defined". Fixed in @patterkit/ops (no default font is loaded at all) and rebundled;
  a bundle smoke test now runs `dist/cli.js` end to end so a bundle-only fault cannot ship green again.
- Updated dependencies [c3ca0c2]
  - @patterkit/ops@0.3.5

## 0.2.4

### Patch Changes

- Updated dependencies [a89d0b8]
  - @patterkit/ops@0.3.4

## 0.2.3

### Patch Changes

- Updated dependencies [dca5b44]
  - @patterkit/ops@0.3.3

## 0.2.2

### Patch Changes

- Updated dependencies [614eaa8]
  - @patterkit/core@0.2.0
  - @patterkit/ops@0.3.2

## 0.2.1

### Patch Changes

- Updated dependencies [2d596c0]
  - @patterkit/ops@0.3.1

## 0.2.0

### Minor Changes

- f5645f5: `unpack --merge` checks that the returned pack, the base pack and the target project are the same project

  Every `.patterpack` manifest has always carried `project.id`, and nothing read it. Pointing a merge at an unrelated project's pack therefore merged by id, matched almost nothing, and produced a mountain of conflicts that read as though the other author had rewritten the whole project.

  `runUnpackMerge` now returns a `ProvenanceCheck` (`{ returned?, base?, target?, ok }`) comparing the three ids, and `patter unpack --merge` prints a warning before its writes when they disagree. It **warns and never refuses**: an id can legitimately differ across a fork or a reissue. A document with no readable manifest still merges, since an id that cannot be read cannot disagree.

  This is the weak half of pack provenance. It cannot detect the wrong _revision_ of the right project, which needs a content hash the format does not yet carry.

### Patch Changes

- Updated dependencies [f5645f5]
  - @patterkit/ops@0.3.0

## 0.1.7

### Patch Changes

- Updated dependencies [d488e49]
- Updated dependencies [4cbaa5a]
  - @patterkit/ops@0.2.3

## 0.1.6

### Patch Changes

- @patterkit/core@0.1.5
- @patterkit/ops@0.2.2

## 0.1.5

### Patch Changes

- Updated dependencies [087ceca]
- Updated dependencies [178967e]
  - @patterkit/ops@0.2.1
  - @patterkit/core@0.1.4

## 0.1.4

### Patch Changes

- Updated dependencies [34429f0]
- Updated dependencies [c61c146]
  - @patterkit/ops@0.2.0
  - @patterkit/core@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [001c1d5]
  - @patterkit/ops@0.1.3
  - @patterkit/core@0.1.2

## 0.1.2

### Patch Changes

- @patterkit/core@0.1.1
- @patterkit/ops@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [34bdd67]
  - @patterkit/ops@0.1.1
