# Changelog

## 0.2.1

### Patch Changes

- Updated dependencies [34429f0]
- Updated dependencies [34429f0]
- Updated dependencies [c61c146]
  - @patterkit/model@0.2.0
  - @patterkit/dialect@0.1.3

All notable changes to `@patterkit/runtime` (Patterplay JS) are documented here. The
Patterplay runtimes - JS, Unity, Unreal, and Godot - are versioned in lockstep: the same
version number always means the same runtime behaviour. This package is versioned by
`npm run bump:play`, not by Changesets.

## [Unreleased]

### Added
- **Host navigation.** `flow.goto(scene, block?)` sends a running flow to a Game ID address, behaving
  exactly like an authored `go` jump: the target scene's `onEntry` runs, arriving counts as a visit, and
  the callstack is replaced (pending call-returns discarded). Being a host action it lands immediately -
  the rest of the snippet being delivered is abandoned and a pending choice dropped - and it MOVES the
  cursor without resetting the flow, so variation, visit counts and per-flow properties carry on. Returns
  `false` with the cursor untouched when the address does not resolve; a block address is scene-scoped.
- **`engine.runFlow(name, scene, block?)`**, the one-call form: opens the named flow if it does not
  exist, moves it if it does, runs to the next stop and returns the beats played. Reusing the name is the
  point - a flow owns its selector cursors, so a shuffle keeps its bag and a "once each" list keeps its
  place from call to call. `[]` means the address has nothing left to give; an unresolvable address
  throws, so the two are never confused.
- `flow.isClosed`, and `engine.sceneAddress` / `engine.blockAddress` are now matched by all four runtimes
  (they were JS-only).

### Changed
- Dropping a flow now FINISHES it. `closeFlow`, `engine.reset()` and re-opening a name all leave the old
  `Flow` inert (`advance()` reports the end, `goto()` refuses), so a stale reference a game still holds
  can no longer keep running scene entry effects and moving shared state. Re-opening a name still
  replaces (and so resets) that flow - use `runFlow` when a speaker's variation state should carry on.

## [0.2.2] - 2026-07-13

### Changed
- Internal: the Best match (`specificity`) selection metric now uses the shared
  `@wildwinter/expr-specificity` package instead of a per-engine inline copy. Behaviour is
  unchanged and conformance-verified across all four engines.

## [0.2.0] - 2026-07-07

### Added

- **Best match** selection (a new `sequence` order, `specificity`): among the eligible children,
  play the one whose condition most specifically fits the current state; equally-specific ties break
  by the seeded shuffle, and a condition-less child is the filler that wins only when nothing more
  specific applies. Composes with the exhaust axis (re-pickable, or graceful degradation to the
  filler). Locked by the conformance corpus, so all four runtimes agree.

## [0.1.0] - 2026-07-04

### Added

- The Patter runtime in JS/TS: `Engine` + `Flow` over a compiled `.patterc` bundle - scenes,
  blocks, run/choice/branch/sequence selectors, sticky/fallback options, call-return jumps,
  conditions + effects, visit counts, `{@ref}` interpolation, game events, tags, gameData
  merge-at-read, and whole-game save/load (`saveGame` / `loadGame`).
- The `patterplay.min.js` drop-in: the whole runtime as one self-contained `<script>` file
  (`window.Patterplay`), for plain HTML pages with no bundler.
- Localisation: play any locale of an Embedded bundle, switch live with `setLocale`, or ship
  an IDs-only bundle and localise in your own system (`flow.interpolate`). Closed-caption cue
  stripping via `setClosedCaptions`.
- Live refresh: `replaceStrings` (text-only edits, in place) and `hotSwap` (structural edits,
  state carried over) - the engine side of Patterpad's Live Link hot reload.
- Structure introspection: `getOutline()` / `getBeatSequence()` expose the authored tree
  (per-beat text, character, gameData, tags) for tooling.
- Companion helpers live in `@patterkit/play-helpers` (save envelopes, property setters,
  state logger, Live Link client, property inspector, audio resolution).
- Distribution: `patterplay-js-<version>.zip` on each `play-js-v*` GitHub Release (the
  runtime + module builds + two demos, no npm needed), npm, and the CDN drop-in - all the
  same version.
