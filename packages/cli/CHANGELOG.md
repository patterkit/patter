# @patterkit/cli

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
