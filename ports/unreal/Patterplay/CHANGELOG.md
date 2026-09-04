# Changelog

All notable changes to Patterplay for Unreal are documented here (the release zip also
carries the PatterplayDemo sample project). The Patterplay runtimes - JS, Unity, Unreal,
and Godot - are versioned in lockstep: the same version number always means the same
runtime behaviour.

## [Unreleased]

## [0.12.0] - 2026-09-04

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  the JS runtime's: `patterplay.min.js`, the browser drop-in, is now built by `@patterkit/play-helpers`
  and carries the play helpers (save / load, state logger, inspectors, Live Link) as well as the
  runtime on the one `Patterplay` global, so a plain web page can write the family's save text with
  no bundler. This plugin is unchanged; a save it writes still loads there and back.

## [0.11.0] - 2026-09-03

### Fixed

- **A `writable: false` host declaration is refused by the engine, bound or self-backed.** The core let a
  bound scope's `set` straight through, so the story's own promise held only for the self-backed bag;
  now `'@world.x' is read-only` is thrown from either, as the JS runtime always has. Pinned in the
  TestHost. Also pinned: `Patterplay.World` exercises the wrapper's `Create(Bundle, World)` path.

### Added

- **`UPatterWorld`: the game's `@world` container, bound at `UPatterEngine::Create(Bundle, World)`.** Typed
  `Set*` / `Get*`, `Has`, `Names`, `SetReadOnly` for the game's own read-only policy, and an `OnChanged`
  delegate that tells host writes from story writes; `GetBoundWorld()` says which you have. The binding
  survives `HotSwap` / `ApplyLiveBundle`, a save never carries the container and a load never writes it.
  Until now the wrapper took no host scopes at all and a game sharing `@world` with anything else had to
  build `patter::Engine` by hand on a copied bundle, which is the code the wrapper exists to spare
  people. Same shape as the Storylet Engine's `UStoryletWorld`, so a project running both reads one API
  (from-storylets/unreal-wrapper-host-scopes). `Patterplay.World` is the automation case.

### Changed

- **Saves cross engines.** `Patter/Save.h` now writes and reads the family's `patter/save@0` shape - the
  JS reference's, documented in `@patterkit/model` - so a save written by a web build or by Patterpad
  loads here, and a save written here loads in Unity or Godot. Until now this plugin kept the execution
  position flat and a pending choice as `pendingGroupId` + `pendingOptions`, so a JS save loaded here
  with its flow intact and its choice silently gone: `GetChoices()` came back empty and the conversation
  could not continue. **A save written by this plugin before 0.11.0 still loads** and is written back in
  the shared shape. The conformance corpus now carries a save the JS reference wrote, which this plugin
  must load, write back with the same key paths, and continue (from-storylets/save-shape-across-engines).

## [0.10.0] - 2026-09-02

### Added

- **`Engine::listBags()`, `Flow::listBags()` and `Engine::flows()`.** What a state logger
  mounts; parity with the JS runtime and the other ports.

### Changed

- **The state logger watches the property bags instead of diffing save snapshots.** A
  property write is logged when it LANDS, on the bag's audit hook, rather than at the next
  capture. The visit counts live in no bag, so those are still diffed - which is all this
  logger used to do for everything. What it buys: a diff can only report the NET change
  between two captures, so a value that changed and changed back was invisible, and every
  write was reported late. The core is shared with the Storylet Engine, which has always
  worked this way.
- **The `@patter` globals, and a flow's not-shared half, live in a property bag.** They were
  plain maps here while the JS runtime held them in a bag; a bag is what carries the audit
  hook the logger pushes from. **The save format is unchanged** - the same flat map, and a
  load seeds from the declarations before laying saved values over.
- **BREAKING: the C++ core's state logger object is `patter::PatterStateLog`, not
  `patter::StateLogger`.** The shared kernel's class is vendored into this namespace and owns
  that name. `StateChange` is the kernel's too: `from` and `to` are `std::optional` where
  this core had a bool beside each value. The Blueprint API is unchanged.

### Fixed

- **A declaration with an explicit `null` default seeds the type's default.** Two halves of
  one rule disagreed: the seeding read the key directly, where `default_for` treats null and
  absent alike, so a `number` could hold nil. Unreachable from an exported bundle; a
  hand-written or third-party one could do it.

## [0.9.0] - 2026-09-02

### Changed

- **BREAKING: `FPatterPropertyRow::Ref` is now `Path`, with `Name` beside it.** The shape is
  `@wildwinter/scoperegistry`'s property row, shared with the Storylet Engine. `Path` holds exactly
  what `Ref` held: the reference GetProperty / SetProperty take. Blueprints reading `Ref` need
  repointing at `Path`. The C++ core's `patter::PropertyRow` changed with it and gained `writable`.
- **BREAKING: a row's address is the qualified one, `@patter.gold`, not `@gold`.** Both forms
  have always resolved on input and still do - an unqualified name defaults to the `patter`
  scope - so `GetProperty("@gold")` is unaffected. What changed is the address a row REPORTS,
  which is what a state panel displays and what an inspector writes back through. It matches
  what `@scene` and the other family's scopes have always looked like.

- **Scene and stage state is held in the shared property bag.** `@scene` properties lived in
  hand-rolled maps that duplicated the bag's own seeding, so they missed its guards: two flows
  entering one scene now never share a mutable flags list, and a `temporary` property's reset on
  re-entry goes through the bag, which means a state logger sees it. **The save format is
  unchanged** - a flat name/value map per scene, and a load that seeds from the bundle's
  declarations before laying saved values over, so a property a save predates keeps its default.
- **BREAKING: the C++ core's `patter::PropertyView` is gone; `listProperties()` returns
  `patter::PropertyRow`.** It was the shared row plus a `path`, and `path` is on the shared row
  now. The Blueprint-facing `FPatterPropertyRow` is unchanged. Re-declaring `path` on a derived
  struct would have SHADOWED the inherited one - written on the derived, read as empty through a
  `PropertyRow&`.

### Added

- **A decision log, and `OnDryChoice`.** Opening a run with `bLog` records what the engine
  decided and why - each choice with the options it offered, the ones it greyed out and the
  reason, each jump, each property write with the value it replaced. `GetLog()` is the whole
  run in order, a `Flow`'s own log is flow-local, and `OnTrace` streams entries live rather than
  retaining them. `OnDryChoice` fires when a choice runs dry - no takeable option, no eligible
  fallback - so the silent fall-through is observable; it survives alongside the log because it is
  live feedback, not a record.

### Fixed

- **A quality row carries its ladder.** `stages` was on the row so an examiner could offer the
  stages instead of a free-text box, and the code that builds rows never filled it in - on this
  runtime and two others. Every quality row came out without one.

## [0.8.0] - 2026-09-01

### Changed

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order, so
  `check_flags` results and stored flag lists that hold the same members are equal
  however they were built. They are compared as multisets, so a duplicated flag
  still counts.

  This is a behaviour change to existing content, and it is a fix rather than a
  preference: a flags value IS a set, and its stored order was an artefact of the
  order somebody happened to add things in. `set_flags(@f, +red)` then `+blue`
  compared UNEQUAL to the same two flags added the other way round, a difference
  no author can see and none intends. An expression that relied on two
  equal-membered flag values comparing unequal will change answer.

### Fixed

- **The PRNG seed is coerced the way JavaScript coerces it** (ECMA-262 ToUint32),
  so every runtime lands on the same first draw for every seed. Seeds outside the
  range of a 64-bit integer (`1e19`, `Infinity`) previously gave a different
  answer here from the JS runtime.
- **Undefined behaviour when a seed or a saved PRNG state left `int64` range.**
  `static_cast<uint32_t>` on an out-of-range double is UB, and it really was
  undefined: the shipped line produced `0` at `-O0` and garbage at `-O2`. It
  reached the SAVE path as well as the seed, where the JS runtime's signed
  `rngState` hit it for more than half of all saves.
- **Numbers render the way JavaScript's `String(n)` renders them.** `jsNumber`
  used a 1e15 integral cutoff and a fixed `%.15g`, so `1e16` printed as `1e+16`
  and `0.1 + 0.2` as `0.3`. This is visible wherever a number reaches displayed
  text through interpolation.
- **`==` between a whole number and a float.** `3` and `3.0` compared unequal;
  the reference has one number type, so they are the same value.

### Changed

- `PatterValue`, `PatterKind`, `Mulberry32`, the AST and the evaluator moved to
  `Public/Patter/Expr/`, generated from a single shared source also used by the
  Storylet Engine. Types, namespace and members are unchanged.
- **`Patter/Expression.h` is now a forwarding header.** It remains part of the
  public surface and still compiles, so an existing `#include` is safe. New code
  should include `Patter/Dialect.h`.
- **`Patter/Dialect.h` is new**: the built-ins split out of the evaluator, which
  is the seam that lets both plugins run one evaluator source. `Mulberry32` gains
  `state()` / `setState()` in place of a public `a` field.


## [0.7.1] - 2026-08-30

### Added

- **The Runtime State panel says whether Patterpad is listening.** A Live Link registered with
  `FPatterDebug::RegisterLink(Link)` shows its state (connecting / connected / closed), the address it
  dials and the build it handshook. From inside a running game, "the editor is not listening" and
  "I never attached" look identical, and only the game knows which.

### Fixed

- **A flow you forgot to announce still shows up in Patterpad's debug link.** `flowOpened` was the
  host's job and nothing could check it, so a game that opened a flow and did not announce it left
  the editor's follow list short - and the omission outlived a reconnect, because the link's hello
  carries that list. A flow now announces itself the first time it is observed; `flowOpened` remains
  worth calling for a flow that exists before it says anything. Reported from the Storylet Studio
  side, 2026-08-29. (Same fix in all four runtimes.)

## [0.7.0] - 2026-08-29

### Added

- **Blueprint can manage flows.** `GetFlow` (fetch one already open by name), `CloseFlow` and `Reset`
  on the engine, and `Close` on a flow. A Blueprint-only game that opens a flow per speaker had no
  way to shut one down or to ask whether one was still live; these existed in the C++ core and were
  recorded in the parity table as unsurfaced.

### Changed

- The core owns its flows by `shared_ptr` rather than `unique_ptr`, and `UPatterFlow` holds a share
  instead of a borrowed pointer. Source-compatible: `openFlow` / `getFlow` still return `Flow*`, so
  existing C++ is unaffected; the new `flowPtr(id)` is the owning handle. A wrapper that misses a
  re-bind now reads as a finished flow rather than as freed memory, which brings C++ into line with
  the three reference-counted runtimes.

### Fixed

- **A `UPatterFlow` you are holding survives a save/load.** The core owns its flows by value and
  `loadGame` clears and rebuilds them, so every wrapper the game held pointed at freed memory the
  moment a save was loaded - and `LoadStateFromJson` returned true, giving no sign. Wrappers are
  re-bound by id after a load (the hot swap already did this; the save path did not), and a flow the
  save did not carry comes back closed rather than dangling. Reported from the Storylet Studio side,
  2026-08-29, found while building their own Unreal wrapper against this one.
- **A refused save file says why.** `LoadStateFromJson` caught the exception and returned a bare
  `false`; it now logs the reason. An automation test that asserts a refusal needs an
  `AddExpectedError`, since UE counts a logged error as a test failure.

## [0.6.0] - 2026-08-25

### Added

- **The `quality` property type: a story stage as an ordered ladder of named stages.** The value is a
  stage name; ordering operators compare by ladder POSITION, `advance(@q)` steps to the next stage
  saturating at the last, and a save carries the stage by name - so a stage inserted mid-production
  shifts nothing. Declared with `stages` on the property; seeds at the first stage. Corpus-locked
  across all four runtimes (gating, stepping, and the insertion story through a live hot swap).
  The runtime state inspector edits a quality as a dropdown of its stage ladder, like an enum's
  values.

## [0.5.0] - 2026-08-21

### Added

- **Cast lists you can query at runtime.** Three static reads answer "who is in this?": the cast the
  project declares, the speakers of a scene, and the speakers of one block. Scene and block refs take
  an internal id or a gameId address. The result is the character token a line beat carries, deduped
  and ordered by first appearance, and it is derived from the AUTHORED structure, so a speaker behind a
  condition, inside a group, or voicing a choice prompt is included: it answers who *can* speak, not
  who a given playthrough heard. Held across all four runtimes by the conformance corpus.
  `Engine->getCast()`, `castForScene`, `castForBlock`, each also exposed to Blueprint as `GetCast`,
  `CastForScene` and `CastForBlock` (BlueprintPure).

## [0.4.5] - 2026-08-20

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  Godot-only (#45); this runtime is unchanged.

## [0.4.4] - 2026-08-20

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The fix in this release is
  Godot-only (#45); this runtime is unchanged.

## [0.4.3] - 2026-08-19

### Added

- **The bundle inspector.** Select an imported `.patterc` and see what your game code may call, read
  from the asset alone with nothing running: the project's identity and hashes, every scene and block
  ADDRESS `runFlow` / `goto` accept, the `@world` properties the GAME must supply (with the ones
  carrying no default marked, because those are the values a story silently reads as a type default
  if the host forgets them), the story's own declarations, the gameData fields, and counts for "is
  this the right build?". A source-debug build says NOT SHIPPABLE rather than leaving it to be
  inferred from `strings: ids`.

  The summary itself is available to code as well (`patter::describeBundle`), so a build step or
  an editor tool can read the   same description the panel draws.

  Shown as details categories on a selected `UPatterBundle`. A bundle that fails to parse now keeps
  its error on the asset (`LoadError`) and the panel shows it first, so a bad export is diagnosed
  where you are looking instead of only in the log.

  Also: a UE-boundary automation test (`Patterplay.Smoke`, in the Session Frontend or via
  `-ExecCmds="Automation RunTests Patterplay.Smoke"`). The conformance corpus runs against the
  std-only core, so nothing UE-facing had a test of any kind; this covers the JSON loader, the
  UObject wrappers and the description.

## [0.4.2] - 2026-08-19

### Added

- **Declared host scopes (`@world`) are parsed and self-backed.** A project can DECLARE host properties
  in its bundle (`scopeRegistry`); this port ignored them entirely, so `@world.isNight` resolved to
  nothing, read as a graceful false, and any branch gated on it was skipped. The same bundle therefore
  played a different story here than on the JavaScript runtime, with no error anywhere. The registry is
  now parsed into the bundle model, a scope the embedder binds is theirs, and every other declared scope
  gets a live bag seeded from its declaration defaults. The shared conformance corpus gates this.

## [0.4.0] - 2026-07-30

### Added
- **State logger** (parity: previously JS-only). Watches the mutable runtime state - `@patter`
  globals, per-scene `@scene` props, and visit counts (shared + per-flow) - and reports what changed
  between captures, plus a per-step trace including `gameData`. Built on the engine's save-game, so
  what the logger sees is exactly what a save persists. Identical flattened-path and line format on
  every runtime.
- **`patter::serializeState` / `deserializeState`: the tagged `patter/save@0` envelope** in the
  std core (parity with the JS and Unity save helpers) - the whole game to a JSON string and back,
  with foreign blobs refused. **`UPatterSave`** exposes it to Blueprint (`SaveStateToJson` /
  `LoadStateFromJson`), so a Blueprint-only game can save and load without C++.
- The **Runtime State panel gains Save State... / Load State...** buttons (`.patterstate` files via
  native dialogs) - the parity of Unity's window and Godot's panel.

### Fixed
- The download now includes the **MIT `LICENSE` file**; previously the zip shipped with no licence
  text at all.

## [0.3.1] - 2026-07-22

### Fixed
- The plugin no longer refuses to load on Unreal 5.7 point releases. The `.uplugin` pinned
  `EngineVersion` to `5.7.0`, an exact-patch lock that made 5.7.4 (the only 5.7 the Epic launcher
  offers) reject it as built for a different engine version. It ships as source and builds against
  any 5.7 release, so the pin is gone. (#25)
- Made the header-only engine core compile under MSVC, not only Clang. `Expression.h` used
  `std::vector` without including `<vector>`, and `PatterValue.h` / `Bundle.h` / `Engine.h` used
  `std::move` / `std::pair` without `<utility>`. Clang supplied these transitively so Mac builds
  passed, but MSVC does not, producing "is not a member of std" errors on Windows. (#25)

## [0.3.0] - 2026-07-21

### Added
- **Host navigation.** `Goto` (BlueprintCallable) sends a running flow to a Game ID address, behaving exactly like a jump
  the writer could have written: the destination scene's on-entry effects run, arriving counts as a
  visit, and the call stack is replaced. Being a game action rather than a written one it lands
  immediately (any remaining lines of the snippet being delivered are abandoned, and a pending choice is
  dropped), and it MOVES the cursor without resetting the flow - variation, visit counts and properties
  all carry on. Returns false, cursor untouched, on an address that does not resolve.
- **`RunFlow`** (BlueprintCallable) plays an address in one call: it opens the named flow if it does not exist, moves it if it
  does, runs to the next stop and returns what played. Reusing the name is the point - a flow owns its
  selector cursors, so a shuffle keeps its bag and a "once each" list keeps its place from call to call.
  Use one name per speaker. An empty result means that address has nothing left to give.
- **`AdvanceToStop`** (BlueprintCallable) (parity): advance repeatedly, collecting every beat played, until a choice or the end.
  Previously only the JS runtime had this.

### Changed
- Dropping a flow now FINISHES it. Closing a flow, resetting the engine, or re-opening a name all leave
  the old flow object inert, so a reference a game still holds cannot keep advancing it and quietly move
  shared state. Re-opening a name still replaces (and so resets) that flow - use `RunFlow` when you
  want a speaker's variation state to carry on instead.

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
- The native C++ Patter runtime (header-only, standard library only) wrapped in a Blueprint-
  and C++-friendly plugin: scenes, blocks, run/choice/branch/sequence selectors,
  sticky/fallback options, call-return jumps, conditions + effects, visit counts, `{@ref}`
  interpolation, game events, tags, and gameData merge-at-read.
- `UPatterEngine` / `UPatterFlow` + `FPatterStep` / `FPatterOption`: the whole play loop
  drivable from C++ or Blueprint, plus typed property get/set (`@patter` and wired external
  values).
- A `.patterc` importer: the file becomes a `UPatterBundle` asset in the content browser.
- Localisation: play any locale of an Embedded bundle, or ship an IDs-only bundle and
  localise in your own system. Closed-caption cue stripping supported.
- Audio resolution: `UPatterAudio` (BlueprintCallable) resolves each line to its winning take
  from a `patteraudio.json` manifest (it resolves the path; playback stays yours).
- Live state: the **Window ▸ Tools ▸ Patterplay Runtime State** editor panel watches and
  edits a running engine's `@patter` properties (type-aware editors + reset-to-default);
  register with `RegisterForDebug`.
- Live Link: `FPatterDebugLink` streams the story cursor to Patterpad and hot-reloads edited
  bundles into the running game (`ApplyLiveBundle`: strings-only or full swap, state kept).
- Structure introspection: `GetOutline` / `GetBeatSequence` expose the authored tree
  (per-beat text, character, gameData, tags) for tooling like Sequencer binding.
- The sibling **PatterplayDemo** sample project (open its `.uproject` straight from the
  unpacked zip): `APatterplayDemoActor` (the minimal integration) and `ATourDemoActor` (the
  interactive Patter tour, with optional audio resolution).
