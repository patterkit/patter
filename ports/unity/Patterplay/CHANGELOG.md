# Changelog

All notable changes to Patterplay for Unity are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

### Changed

- **Saves cross engines.** `PatterSave` now writes and reads the family's `patter/save@0` shape - the JS
  reference's, documented in `@patterkit/model` - so a save written by a web build or by Patterpad loads
  here, and a save written here loads in Godot or Unreal. Until now this package wrote PascalCase keys
  (`StageBags`, `Flows`) and a one-level `Shared` off reflection, which loaded nowhere else, and a JS
  save loaded here threw on its first nested object. The envelope is now built and read by literal key.
  **A save written by this package before 0.11.0 still loads** and is written back in the shared shape.
  The conformance corpus now carries a save the JS reference wrote, which this package must load, write
  back with the same key paths, and continue (from-storylets/save-shape-across-engines).

## [0.10.0] - 2026-09-02

### Added

- **`Engine.ListBags()`, `Flow.ListBags()` and `Engine.Flows()`.** What a state logger mounts;
  parity with the JS runtime and the other ports.

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
- **BREAKING: `PatterStateLogger.CreateStateLogger` returns `PatterStateLog`, not
  `StateLogger`.** The shared kernel's class is vendored into this namespace and owns that
  name now. The members are unchanged, and hosts almost always hold it with `var`.

### Fixed

- **A declaration with an explicit `null` default seeds the type's default.** Two halves of
  one rule disagreed: the seeding read the key directly, where `default_for` treats null and
  absent alike, so a `number` could hold nil. Unreachable from an exported bundle; a
  hand-written or third-party one could do it.

## [0.9.0] - 2026-09-02

### Changed

- **BREAKING: `PropertyRow.Ref` is now `PropertyRow.Path`, and the row carries `Writable`.** The
  shape is `@wildwinter/scoperegistry`'s property row, shared with the Storylet Engine. `Path` holds
  exactly what `Ref` held: the reference `GetProperty` and `SetProperty` take. `Name` was already
  there. Anything reading `row.Ref` reads `row.Path`.
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
- **BREAKING: `PropertyView` is gone; `ListProperties()` returns `List<PropertyRow>`.** It was
  `PropertyRow` plus a `Path`, and `Path` is on the shared row now. C# has no type alias to keep
  the old name alive with, and an empty subclass would be a type a bag's own row could never
  satisfy.

### Added

- **A decision log, and `OnDryChoice`.** Opening a run with `EngineOptions.Log` records what the engine
  decided and why - each choice with the options it offered, the ones it greyed out and the
  reason, each jump, each property write with the value it replaced. `Engine.Log()` is the whole
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
- **A save written before this release now loads.** The JS runtime accumulated
  `rngState` with `| 0`, so more than half of all saves carry a NEGATIVE number
  where the schema says uint32. Newtonsoft refused those with an
  `OverflowException`, which meant a player could not load their own game. Saves
  are read through the same ToUint32 as everything else now, and land on the
  identical PRNG position. Pinned by a regression check in the corpus TestHost.
- **Numbers render the way JavaScript's `String(n)` renders them** for values
  above 2^63. `JsNumber` cast to `long`, so `1e20` printed as
  `9223372036854775807`.
- **`==` between a whole number and a float.** `3` and `3.0` compared unequal;
  the reference has one number type, so they are the same value.
- The PRNG seed is a `double` rather than a `long`, matching the JS API, so the
  coercion happens once and in one place instead of at every call site.

### Changed

- `PatterValue`, `PatterKind` and `Mulberry32` moved to `Runtime/Expr/`, where
  they are generated from a single shared source also used by the Storylet
  Engine. The types, namespace and members are unchanged; only the files moved.


## [0.7.1] - 2026-08-30

### Added

- **The Runtime State window says whether Patterpad is listening.** A Live Link registered with
  `PatterDebug.RegisterLink(link)` shows its state (connecting / connected / closed), the address it
  dials and the build it handshook. From inside a running game, "the editor is not listening" and
  "I never attached" look identical, and only the game knows which.

### Fixed

- **The debug registry no longer keeps a dead engine alive.** `PatterDebug` held engines strongly, so an engine your game replaced - a restart, a scene change, a live bundle swap - stayed in memory with its whole compiled story unless you remembered to `Unregister` it. It holds weak references now, and `PatterDebug.Engines` hands back only live ones.

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
  its flows underneath the wrapper. The C# runtime is reference counted and never had that fault.

## [0.6.0] - 2026-08-25

### Added

- **The `quality` property type: a story stage as an ordered ladder of named stages.** The value is a
  stage name; ordering operators compare by ladder POSITION, `advance(@q)` steps to the next stage
  saturating at the last, and a save carries the stage by name - so a stage inserted mid-production
  shifts nothing. Declared with `stages` on the property; seeds at the first stage. Corpus-locked
  across all four runtimes (gating, stepping, and the insertion story through a live hot swap).
  The runtime state inspector edits a quality as a dropdown of its stage ladder, like an enum's
  values.

### Fixed

- **The live debug link no longer corrupts a pushed bundle at a chunk boundary.** `PatterDebugLink`
  reads the socket in 64 KB chunks, and decoded each chunk on its own, so a multi-byte character
  straddling a boundary became two replacement characters and could leave the pushed JSON unparseable.
  A pushed bundle is exactly the message large enough to span chunks, so any non-ASCII text in the
  story (a curly quote, an accented name) could hit it. The bytes are now accumulated and decoded once
  at the end of the message. Unreal and Godot were checked and never had this: both receive a whole
  message at a time. Reported from the Storylet Studio side.

## [0.5.0] - 2026-08-21

### Added

- **Cast lists you can query at runtime.** Three static reads answer "who is in this?": the cast the
  project declares, the speakers of a scene, and the speakers of one block. Scene and block refs take
  an internal id or a gameId address. The result is the character token a line beat carries, deduped
  and ordered by first appearance, and it is derived from the AUTHORED structure, so a speaker behind a
  condition, inside a group, or voicing a choice prompt is included: it answers who *can* speak, not
  who a given playthrough heard. Held across all four runtimes by the conformance corpus.
  `engine.GetCast()`, `engine.CastForScene(sceneRef)`, `engine.CastForBlock(sceneRef, blockRef)`.

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

  The summary itself is available to code as well (`BundleInfo.Describe`), so a build step or an
  editor tool can read the   same description the panel draws.

  The Inspector for a `PatterBundleAsset` draws it in foldouts, with the raw JSON demoted to the last
  one and a button to copy it. Foldout state survives a domain reload.

## [0.4.2] - 2026-08-19

### Added

- **Declared host scopes (`@world`) are parsed and self-backed.** A project can DECLARE host properties
  in its bundle (`scopeRegistry`); this port ignored them entirely, so `@world.isNight` resolved to
  nothing, read as a graceful false, and any branch gated on it was skipped. The same bundle therefore
  played a different story here than on the JavaScript runtime, with no error anywhere. The registry is
  now parsed into the bundle model, a scope the embedder binds is theirs, and every other declared scope
  gets a live bag seeded from its declaration defaults. The shared conformance corpus gates this.

### Fixed
- **Window ▸ Patterplay ▸ Runtime State now opens docked** (beside the Inspector) instead of
  floating. A floating editor window slides behind the main Unity window the moment you click the
  Game view - exactly when you want to be watching properties change - so a play session meant
  constant alt-tabbing. It is still an ordinary dockable window: drag it wherever you like and Unity
  remembers. (If you have one open from a previous version, close it before reopening; Unity restores
  the old floating position otherwise.)

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
  Unreal-only build issues (see the Unreal changelog and #25); the Unity plugin is unchanged.

## [0.3.0] - 2026-07-21

### Added
- **Host navigation.** `Flow.Goto(scene, block)` sends a running flow to a Game ID address, behaving exactly like a jump
  the writer could have written: the destination scene's on-entry effects run, arriving counts as a
  visit, and the call stack is replaced. Being a game action rather than a written one it lands
  immediately (any remaining lines of the snippet being delivered are abandoned, and a pending choice is
  dropped), and it MOVES the cursor without resetting the flow - variation, visit counts and properties
  all carry on. Returns false, cursor untouched, on an address that does not resolve.
- **`Engine.RunFlow(name, scene, block)`** plays an address in one call: it opens the named flow if it does not exist, moves it if it
  does, runs to the next stop and returns what played. Reusing the name is the point - a flow owns its
  selector cursors, so a shuffle keeps its bag and a "once each" list keeps its place from call to call.
  Use one name per speaker. An empty result means that address has nothing left to give.
- **`Flow.AdvanceToStop()`** (parity): advance repeatedly, collecting every beat played, until a choice or the end.
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
- The native C# Patter runtime: `Engine` + `Flow` over a compiled `.patterc` bundle - scenes,
  blocks, run/choice/branch/sequence selectors, sticky/fallback options, call-return jumps,
  conditions + effects, visit counts, `{@ref}` interpolation, game events, tags, gameData
  merge-at-read, and whole-game save/load (`PatterSave`).
- A `.patterc` ScriptedImporter: drop the file in and it becomes a `PatterBundleAsset` (with
  a custom Inspector); `Bundle.CreateEngine()` from there.
- Localisation: play any locale of an Embedded bundle, switch live with `SetLocale`, or ship
  an IDs-only bundle and localise in your own system. Closed-caption cue stripping via
  `SetClosedCaptions`.
- Audio resolution: `PatterAudioResolver` resolves each line to its winning take from a
  `patteraudio.json` manifest (it resolves the path; playback stays yours).
- Live state: **Window ▸ Patterplay ▸ Runtime State** watches and edits a running engine's
  `@patter` properties (type-aware editors + reset-to-default) and saves / loads the run.
- Live Link: `PatterDebugLink` streams the story cursor to Patterpad and hot-reloads edited
  bundles into the running game (`ApplyLiveBundle`: strings-only or full swap, state kept).
- Structure introspection: `GetOutline()` / `GetBeatSequence()` expose the authored tree
  (per-beat text, character, gameData, tags) for tooling.
- Samples (import via Package Manager), each with a **ready-made scene** - import, open the
  scene, press Play: **Play-through demo** (the minimal integration) and the **Tour demo**
  (the interactive Patter tour, with optional audio resolution).
