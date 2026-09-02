# Changelog

## 0.5.1

### Patch Changes

- Updated dependencies [f97f6eb]
  - @patterkit/model@0.4.0
  - @patterkit/dialect@0.1.6

## 0.4.1

### Patch Changes

- Updated dependencies [614eaa8]
  - @patterkit/model@0.3.0
  - @patterkit/dialect@0.1.5

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

- **`Engine.listBags()` and `Flow.listBags()`.** The kernel bags with the path each answers
  to in a log - the shared `@patter` globals and per-scene props on the engine, a flow's own
  halves prefixed with its id. Parity with the Storylet Engine's method of the same name; it
  is what a state logger mounts. A stage bag's LOG path is `@scene:<sceneId>.` where its
  address is `@scene.`, because a log spans scenes and has to say which one.

### Changed

- **The state logger watches the property bags instead of diffing save snapshots.** A
  property write is logged when it LANDS, on the bag's audit hook, rather than at the next
  capture. The visit counts live in no bag, so those are still diffed - which is all this
  logger used to do for everything. What it buys: a diff can only report the NET change
  between two captures, so a value that changed and changed back was invisible, and every
  write was reported late. The core is shared with the Storylet Engine, which has always
  worked this way.
- **Requires `@wildwinter/scoperegistry` ^0.5.0**, which carries the shared state logger.

## [0.9.0] - 2026-09-02

### Changed

- **BREAKING: a property row's address is `path`, not `ref`, and the row carries `name` and
  `writable`.** `listProperties()` returns the row type from `@wildwinter/scoperegistry` itself,
  rather than a local interface redeclaring it. `path` holds exactly what `ref`
  held: the reference `getProperty` / `setProperty` take. `name` is the bare declared name.
  `writable` is always true here, because Patter has no read-only shared property; it is carried
  because the row is shared with the Storylet Engine, which does declare them.

  The fork it replaces was not free. A quality's `stages` was added to the local copy and so never
  reached the shared type, and the Storylet Engine - reading the same property model through the
  same registry - could not carry a ladder at all: it edited a quality as free text on every
  platform it ships. One row, one place to add the next field.
- **BREAKING: a row's address is the qualified one, `@patter.gold`, not `@gold`.** Both forms
  have always resolved on input and still do - an unqualified name defaults to the `patter`
  scope - so `getProperty("@gold")` is unaffected. What changed is the address a row REPORTS,
  which is what a state panel displays and what an inspector writes back through. It matches
  what `@scene` and the other family's scopes have always looked like.

- **Scene and stage state is held in the shared property bag.** `@scene` properties lived in
  hand-rolled maps that duplicated the bag's own seeding, so they missed its guards: two flows
  entering one scene now never share a mutable flags list, and a `temporary` property's reset on
  re-entry goes through the bag, which means a state logger sees it. **The save format is
  unchanged** - a flat name/value map per scene, and a load that seeds from the bundle's
  declarations before laying saved values over, so a property a save predates keeps its default.
- **BREAKING: `PropertyView` is gone; `listProperties()` returns `PropertyRow`.** It was the
  shared row plus a `path`, and `path` is on the shared row now, so the name was a second name
  for one type. `PropertyRow` is re-exported from `@patterkit/runtime`, so naming a row needs no
  dependency on `@wildwinter/scoperegistry`.
- **Requires `@wildwinter/scoperegistry` ^0.4.0**, which is where the row's `path` lives.

### Added

- **A decision log, and `onDryChoice`.** Opening a run with `log: true` records what the engine
  decided and why - each choice with the options it offered, the ones it greyed out and the
  reason, each jump, each property write with the value it replaced. `Engine.log()` is the whole
  run in order, a `Flow`'s own log is flow-local, and `onTrace` streams entries live rather than
  retaining them. `onDryChoice` fires when a choice runs dry - no takeable option, no eligible
  fallback - so the silent fall-through is observable; it survives alongside the log because it is
  live feedback, not a record.

### Fixed

- **A quality row carries its ladder.** `stages` was on the row so an examiner could offer the
  stages instead of a free-text box, and the code that builds rows never filled it in - on this
  runtime and two others. Every quality row came out without one.

## [0.8.0] - 2026-09-01

### Changed

- **`rngState` is now written UNSIGNED in a save.** It was accumulated with
  `| 0`, so more than half of all saves carried a negative number where the
  schema says uint32. The draws were unaffected (signed and unsigned
  accumulation produce bit-identical draws), but the native ports could not read
  those saves back: Unity threw, and C++ read them through undefined behaviour.

  Old saves still load here, because restore already coerced, and the native
  ports now coerce too. No gameplay changes.

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order.
  They are compared as multisets, so a duplicated flag still counts. A flags
  value IS a set, and its stored order was an artefact of the order somebody
  happened to add things in: `set_flags(@f, +red)` then `+blue` compared UNEQUAL
  to the same two flags added the other way round. An expression that relied on
  that will change answer.

- The PRNG is now `@wildwinter/expr`'s `makePrng` rather than a copy inline here.
  Same algorithm, same draws; mulberry32 existed thirteen times across the two
  product families and is a fixed published algorithm neither owns.


## [0.7.1] - 2026-08-30

### Fixed

- **A flow you forgot to announce still shows up in Patterpad's debug link.** `flowOpened` was the
  host's job and nothing could check it, so a game that opened a flow and did not announce it left
  the editor's follow list short - and the omission outlived a reconnect, because the link's hello
  carries that list. A flow now announces itself the first time it is observed; `flowOpened` remains
  worth calling for a flow that exists before it says anything. Reported from the Storylet Studio
  side, 2026-08-29. (Same fix in all four runtimes.)

## [0.7.0] - 2026-08-29

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The fix in this release is
  Unreal's: a `UPatterFlow` held across a save load pointed at freed memory, because the core rebuilt
  its flows underneath the wrapper. This runtime is reference counted and never had that fault.

## [0.6.0] - 2026-08-25

### Added

- **The `quality` property type: a story stage as an ordered ladder of named stages.** The value is a
  stage name; ordering operators compare by ladder POSITION, `advance(@q)` steps to the next stage
  saturating at the last, and a save carries the stage by name - so a stage inserted mid-production
  shifts nothing. Declared with `stages` on the property; seeds at the first stage. Corpus-locked
  across all four runtimes (gating, stepping, and the insertion story through a live hot swap).

## [0.5.0] - 2026-08-21

### Added

- **Cast lists you can query at runtime.** Three static reads answer "who is in this?": the cast the
  project declares, the speakers of a scene, and the speakers of one block. Scene and block refs take
  an internal id or a gameId address. The result is the character token a line beat carries, deduped
  and ordered by first appearance, and it is derived from the AUTHORED structure, so a speaker behind a
  condition, inside a group, or voicing a choice prompt is included: it answers who _can_ speak, not
  who a given playthrough heard. Held across all four runtimes by the conformance corpus.
  `engine.getCast()`, `engine.castForScene(sceneRef)`, `engine.castForBlock(sceneRef, blockRef)`.

## [0.4.5] - 2026-08-20

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  Godot-only (#45); this runtime is unchanged.

## [0.4.4] - 2026-08-20

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The fix in this release is
  Godot-only (#45); this runtime is unchanged.

## [0.4.3] - 2026-08-19

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. This release brings the bundle
  inspector to Unity, Unreal and Godot; `describeBundle` has been in the JavaScript runtime since
  0.4.1 and is unchanged.

## [0.4.2] - 2026-08-19

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. This release brings Unity,
  Unreal and Godot up to the JavaScript runtime's declared-host-scope behaviour; the JavaScript
  runtime itself is unchanged since 0.4.1.

## [0.4.1] - 2026-08-19

### Fixed

- **A declared host-scope property whose name carried a capital letter could never be read.** With no
  host resolver bound for a scope, `@world` is self-backed from its declaration defaults - and that bag
  was seeded with the declared name VERBATIM, while the compiler folds every property reference to
  lower case. So a bundle declaring `@world.isNight` compiled a reference to `isnight`, the bag held
  `isNight`, and the two never met: the read returned `undefined` and the gate took the falsy branch,
  silently playing a different story from the same bundle. Only all-lowercase names ever worked. The
  bag is now keyed lower case on seed, get and set. (`@patter` and `@scene` already normalised; this
  resolver was the one that did not.) Declaring such a name is now refused at compile time as well.

## [0.4.0] - 2026-07-30

### Added

- **State logger** (parity: previously JS-only). Watches the mutable runtime state - `@patter`
  globals, per-scene `@scene` props, and visit counts (shared + per-flow) - and reports what changed
  between captures, plus a per-step trace including `gameData`. Built on the engine's save-game, so
  what the logger sees is exactly what a save persists. Identical flattened-path and line format on
  every runtime.

### Fixed

- The download now includes the **MIT `LICENSE` file**; previously the zip shipped with no licence
  text at all.

## [0.3.1] - 2026-07-22

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. This release fixes
  Unreal-only build issues (see the Unreal changelog and #25); the JavaScript runtime is unchanged.

## [0.3.0] - 2026-07-21

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
