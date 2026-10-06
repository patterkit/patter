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

### Changed

- **The conformance corpus covers more, and every runtime is held to it**: the outline and beat sequence, the
  audio resolver's joins, `listProperties`, what a checkpoint refuses while it is open, a save taken inside one,
  and a block named under another scene.

## [0.20.0] - 2026-10-06

### Added

- **`hostScopes`, the engine option every other runtime takes**: the scopes the game binds, by token, each a `{
  get, set? }` over values it owns, as in `hostScopes: { world: { get, set } }`. A resolver's type is
  `HostScope`.
- **`engine.buildId`**, as the other runtimes have: the bundle's content hash, the build a debug link handshakes
  with.
- **A bundle-description section in the conformance corpus.** What `describeBundle` says about one bundle, field
  for field, held on every runtime.
- **`getVisitCounts()` on the engine and on a flow**, on every runtime: how many times each node has been
  entered, across every flow or in this one, read without a save.

### Changed

- **Less work per step.** A decision's log entry is built only while the log is on or something is tracing, and
  a quality's stage ladder is looked up once per set of declarations rather than scanned for on every
  comparison.

### Deprecated

- **`flow.start()` is deprecated: use `flow.reset()`.** They were the same call under two names. `flow.reset()`
  is the one public name for beginning a flow again on every runtime (opening a flow begins a new one);
  `flow.start()` goes in a later release.
- **The `world` option and the `WorldResolver` type: use `hostScopes: { world }` and `HostScope`.** `world` is
  still the world scope, and goes in a later release.
- **The `TraceHandler` type.** Nothing takes one: `onTrace` takes an `EngineTraceHandler`. It goes in a later
  release.

### Fixed

- **`reset()` no longer replays a prompt from the run it abandoned.** With prompt replay on, `choose()` leaves
  the chosen option's prompt waiting for the next `advance()`. `reset()` in between cleared only the choice, so
  the old prompt played as the restarted run's first beat. Every move that leaves the flow's place (`reset()`,
  `goto`, `close`) now drops both, through one helper.
- **`onTrace` hears every decision with the log off.** A `run` walk past a snippet whose condition failed, and a
  write's previous value, were only worked out when the log was on, so a tool tracing a run without the log
  missed the one and got a write without the other. They are now worked out whenever anything is tracing.

## [0.19.0] - 2026-10-06

### Added

- **`EngineOptions.onError` and `PlayError`.** Each condition or effect that fails while the story plays is
  reported to `onError` with the flow, what failed (`condition`, `effect`, or `best-match`), the node, the
  expression's source, and the error. With no `onError`, each goes to `console.warn`. With the log on, each is
  also a `diagnostic` entry in the decision log.

### Changed

- **A condition or effect that fails no longer stops the story.** A failing condition counts as false, and a
  failing effect is skipped while the rest of its list still runs, including a story write a read-only `@world`
  value refuses. This is the same on all four runtimes; JS used to throw out of `advance()`.
- **A part of a Best-match condition that fails scores as false**, as on the other three runtimes. JS threw
  while scoring.
- **A selector evaluates each condition once.** It evaluated each child's condition twice, so a condition
  calling `random(a, b)` drew twice and the logged verdict could disagree with the pick.
- **A shuffle draws only from the children in its bag that are still eligible.** A child whose condition went
  false after the bag was filled could be drawn, and the group then played nothing. When no child left in the
  bag is eligible, the pass ends as if the bag were empty. Seeded results do not change while every child in the
  bag stays eligible.
- **`openFlow`, `goto` and the engine's lookups read an address the same way:** a scene's game id first, then
  its internal id, and a block only within its scene. `openFlow` tried the internal id first, so the two could
  land in different scenes when one scene's id was another's game id.
- **A choice whose every remaining option is greyed out runs dry**, as a choice with no options does: the
  fallback follows if there is one, otherwise the flow moves on and `onDryChoice` fires. It used to be offered
  with nothing the player could take.
- **An option's prompt beat carries tags**: its own and the option's. A replayed prompt and the outline lost
  them.
- **`loadGame` checks a save before changing anything.** A save missing its flows used to close every flow and
  load the registry before failing, leaving the engine half-loaded.

### Fixed

- **`@wildwinter/expr` 0.5.1 and `@wildwinter/scoperegistry` 0.8.1 (kernel `k492cf234`):** a listener's own
  error is no longer reported as a read-only refusal, every listener registered when a write starts hears it
  exactly once, and the hot path allocates less, with no leaks.
- **A rollback after a load keeps a scene's saved `@scene` values.** After a load, a scene the flow is not
  standing in keeps its saved values waiting until the flow enters it. Entering it inside a checkpoint and then
  rolling back used to drop those values, so the next real entry found the defaults and the next save left them
  out. A new corpus case pins this on all four runtimes.
- **The decision log's `seq` keeps counting after a clear.** The engine's log numbered entries by its length, so
  after `clearLog()` the numbers started again at 0 and entries read either side of the clear could not be put
  in order.

## [0.18.0] - 2026-10-05

### Changed

- **`replayPromptOnChoose` speaks back only an authored prompt, and exactly what the choice showed.** A game that
  turns the option on will see the difference, which is why this is a minor release rather than a patch:
  - An option whose prompt the choice borrowed from its own first content line (a bare-snippet option,
    or an Option group with no prompt of its own) is no longer spoken back. That line used to play twice
    in a row, once as the replay and once as content. It now plays once.
  - The replayed prompt carries the text, `character`, `characterName`, and `direction` the choice
    displayed, instead of resolving the prompt again when it is delivered. So if choosing runs effects
    first (an Option group that picks a snippet runs its onEnter at once), or the language changes
    between `choose()` and the next `advance()`, the replay still says what the player saw. In a voiced
    project a replayed line prompt is now interpolated, as the choice showed it.
  - A save taken between `choose()` and the next `advance()` carries that prompt as shown, in a new
    optional `pendingPrompt` on the flow's cursor, so the replay after a load is the same. Every
    Patterplay runtime writes and reads it. A save from an earlier version, without it, still loads and
    resolves the prompt when it is delivered, as before.
    The save shape's `FlowCursor.pendingPrompt` is typed in `@patterkit/model`.

## [0.17.0] - 2026-10-05

### Fixed

- **`openFlow` at an address that does not resolve changes nothing.** It threw, but only after closing
  any flow already open under that name and putting a broken one in its place. It now throws before
  anything changes. The block must be in the scene you named, as `goto` has always required: a block
  from another scene used to open there, and now throws. Held across all four runtimes by the
  conformance corpus, which now also pins a choice step whole (its `groupId` and each option's
  `prompt`), as this runtime already gave it.

## [0.16.0] - 2026-10-04

### Added

- **Checkpoints: try something, then undo it.** `engine.checkpoint()` opens a checkpoint; `engine.rollback(checkpoint)` puts the game back exactly
  as it was then, and `engine.commit(checkpoint)` keeps everything. A rollback undoes every change the story made in between:
  property values in every scope (a game's own `@world` store is written back through the game), visit
  counts, shuffle and sequence positions, `@scene` bags made since, and every flow's position and random
  state; a flow opened since is closed, and its name is free again. `engine.inCheckpoint` says whether one is open.
  The use is asking "would this say anything?" without consequences: move a flow to an address, step
  it, and roll back if it had nothing to give, so the scene's on-entry effects, the visits, and the
  shuffle draws never happened. Each change records how to undo itself as it happens, so a checkpoint
  costs what the steps inside it do, not what the game has built up, and the record is let go when it
  closes. One is open at a time; while it is, the calls a rollback couldn't undo are refused
  (`reset`, `loadGame`, `hotSwap`, `closeFlow`, `openFlow` over an open flow, and a flow's own `start`, `reset`, and `restore`). Held across all four runtimes by the conformance corpus.

### Fixed

- **`Flow.restore()` on a running flow keeps that flow's own property values.** It used to drop them back to
  their defaults, since a snapshot holds a flow's position and memory, not its property values. Loading
  a save is unchanged.

## [0.15.0] - 2026-10-03

### Added

- **Scene and block gameData you can read at runtime.** The bundle always carried a scene's and a
  block's gameData, but nothing handed it to the host. Two static reads now do, by internal id or
  gameId address. They return the node's own overrides, raw, the same rule as a beat's
  `step.gameData`: the project's field defaults are not merged in (resolve them with
  `effectiveGameData`), and a block does not inherit its scene's. A node that sets none, or a ref
  that does not resolve, gives an empty object. `getOutline()` carries the same overrides as
  `gameData` on each scene and block, left out when empty. Held across all four runtimes by the
  conformance corpus. `engine.gameDataForScene(sceneRef)`, `engine.gameDataForBlock(sceneRef, blockRef)`.

## [0.14.3] - 2026-09-27

### Fixed

- **The JS zip's module builds work without npm.** The zip carried the npm package's module build,
  which imports five other packages the zip never included, so copying it into a project and
  importing it failed until you installed them from npm. The zip now carries builds of the runtime
  and of `@patterkit/play-helpers` with their dependencies inside them, under
  `@patterkit/runtime/dist/` and `@patterkit/play-helpers/dist/`. They carry their own registry as a
  result; to share one registry between engines, install from npm. The npm package is unchanged.

## [0.14.2] - 2026-09-27

### Changed

- **`@wildwinter/scoperegistry` is a peer dependency.** Your game and every engine in it share one
  registry, so there must be exactly one copy in the install. As a peer, npm installs it once for all
  of them, and if two packages ever need versions that can't be one copy, the install stops and says
  so instead of quietly adding a second. npm installs it for you; with a package manager that doesn't
  install peer dependencies, add `@wildwinter/scoperegistry` yourself.

## [0.14.1] - 2026-09-27

### Fixed

- **One copy of `@wildwinter/scoperegistry` again.** 0.14.0 asked for `^0.7.0` while
  `@patterkit/dialect` 0.2.1 asks for `^0.8.0`, so an install got two copies, and a `ScopeRegistry`
  your game made was not the one the runtime used. The runtime now accepts any version from 0.7.0 up
  to 1.0, so it shares whichever copy the rest of your install has, and a later registry release
  cannot split it again. The runtime's behaviour is unchanged.

## [0.14.0] - 2026-09-24

### Added

- **Other engines' scopes, with no setting.** A Patter line can name another engine's game-wide scope from the family's shared list (`@story.act` in a condition, an effect, or a `{@story.act}` slot) in any project. It is opaque to the compiler, recorded in the bundle (`externalScopes`), and never self-backed. Content that names one runs only where that engine is on the same registry: without it, `openFlow` and `loadGame` refuse before anything changes (`this content names @story, which no engine on this registry registered: give every engine the game's one registry`), and a write to a scope another engine has since removed fails naming the scope instead of landing in `@patter`.

### Changed

- **One registry per game.** Every property bag the engine holds now lives in a `ScopeRegistry`
  (`@wildwinter/scoperegistry` 0.7.0): `@patter` under `patter`, and each flow's and scene's bag
  under a key starting `patter/`. A new `registry` option takes the game's own registry, shared
  with any other engine in the game; without one the engine makes its own and acts as its own game,
  so a single-engine game needs no change.
- **The save is version 3.** `saveGame()` holds what is not a property (cursors, PRNGs, visit
  counts, selector cursors). An engine built without a registry also carries that registry's values
  under `registry`, so one call is still the whole game; an engine given the game's registry leaves
  them to the game, which saves the registry once. Version 2 saves still load, their values moving
  into the registry.
- **A self-backed `@world` is saved.** When the game binds no resolver, `@world` is a property the
  engine's registry stores, so it rides in the save. A resolver the game binds is still external and
  never saved. Given the game's registry, the engine self-backs nothing: `@world` is the game's to
  register there.
- **Every expression reads every registered scope**, so a condition can test another engine's
  `@story.act` in a combined game. A token two engines both want fails as the second is built, naming
  the first.
- `hotSwap` hands every bag to the replacement engine on the same registry. The engine it replaces is
  released and its flows are closed. If the restore fails, the fallback engine keeps the shared
  properties and restarts each flow, where it used to start everything cold.

### Deprecated

- `Engine.save()` / `Engine.load()`, the shared `@patter` values alone. Save the registry instead.

## [0.13.0] - 2026-09-05

### Changed

- **A `writable: false` host declaration is the STORY's promise, and only the story's: the game
  writes it.** `Engine.setProperty` / `Flow.setProperty` are the game's surfaces, so they now write a
  read-only `@world` property whether it is self-backed or bound to a resolver; an effect that writes
  one is refused exactly as before, with the same sentence. Until now the runtime refused every
  caller alike, so a game could not advance its own clock through the engine and a Patterplay
  coverage driver on such a property killed the run - which is how both this project and the
  Storylet Engine found it, on the same day, in different content
  (from-storylets/host-writes-to-read-only-world). The rule now lives in the shared kernel
  (`@wildwinter/scoperegistry` ^0.6.0, an explicit host authority on `set`), so both products mean
  the same thing by the flag.

## [0.12.1] - 2026-09-04

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  the Godot addon's: it now states the Godot version it needs (4.4 or newer, verified on 4.7), which
  had never been stated and never been tested. Nothing in this runtime changed.

## [0.12.0] - 2026-09-04

### Changed

- **`patterplay.min.js` moved to `@patterkit/play-helpers`, and carries the helpers.** The browser
  drop-in used to be this package's own build, runtime alone, so a plain page with no bundler could
  play but not write the family's save text. It is now built by the play-helpers package (the one
  that depends on both) with the runtime AND the helpers under the one `Patterplay` global. The
  play-js release still ships it loose and in the zip; on a CDN it now lives at
  `@patterkit/play-helpers/dist/patterplay.min.js`, and this npm package no longer contains it.
  (Asked for by the Storylets side, whose drop-in took the same shape the same day.)

## [0.11.0] - 2026-09-03

### Changed

- **The `patter/save@0` shape is the family's contract, and its types live in `@patterkit/model`.**
  `SaveEnvelope`, `SaveGame`, `FlowSnapshot`, `FlowCursor` and the rest are exported from the model
  with `SAVE_SCHEMA`, and re-exported here so existing imports keep working. Nothing this runtime
  writes has changed: its output was always this shape. The three native ports now write and read
  it too, so a save crosses engines, and the conformance corpus carries a save this runtime wrote
  that every runtime must load, write back with the same key paths, and continue.
- **A host-scope declaration's `writable: false` is pinned as the story's promise**, refused whether
  the scope is bound by the game or self-backed. This runtime always did so; the test now says it
  in one place, and the three native ports match it from this version.

## [0.10.0] - 2026-09-02

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
