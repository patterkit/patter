# Changelog

All notable changes to Patterplay for Unity are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

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
