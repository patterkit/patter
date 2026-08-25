# Changelog

All notable changes to Patterplay for Unreal are documented here (the release zip also
carries the PatterplayDemo sample project). The Patterplay runtimes - JS, Unity, Unreal,
and Godot - are versioned in lockstep: the same version number always means the same
runtime behaviour.

## [Unreleased]

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
