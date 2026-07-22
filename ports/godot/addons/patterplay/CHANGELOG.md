# Changelog

All notable changes to Patterplay for Godot are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

### Changed
- Version bump only, to keep the four Patterplay runtimes in lockstep. This release fixes
  Unreal-only build issues (see the Unreal changelog and #25); the Godot addon is unchanged.

## [0.3.0] - 2026-07-21

### Added
- **Host navigation.** `flow.goto(scene, block)` sends a running flow to a Game ID address, behaving exactly like a jump
  the writer could have written: the destination scene's on-entry effects run, arriving counts as a
  visit, and the call stack is replaced. Being a game action rather than a written one it lands
  immediately (any remaining lines of the snippet being delivered are abandoned, and a pending choice is
  dropped), and it MOVES the cursor without resetting the flow - variation, visit counts and properties
  all carry on. Returns false, cursor untouched, on an address that does not resolve.
- **`engine.run_flow(name, scene, block)`** plays an address in one call: it opens the named flow if it does not exist, moves it if it
  does, runs to the next stop and returns what played. Reusing the name is the point - a flow owns its
  selector cursors, so a shuffle keeps its bag and a "once each" list keeps its place from call to call.
  Use one name per speaker. An empty result means that address has nothing left to give.
- **`flow.advance_to_stop()`** (parity): advance repeatedly, collecting every beat played, until a choice or the end.
  Previously only the JS runtime had this.

### Changed
- Dropping a flow now FINISHES it. Closing a flow, resetting the engine, or re-opening a name all leave
  the old flow object inert, so a reference a game still holds cannot keep advancing it and quietly move
  shared state. Re-opening a name still replaces (and so resets) that flow - use `run_flow` when you
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
- The pure-GDScript Patter runtime: `PatterEngine` + `PatterFlow` over a compiled `.patterc`
  bundle - scenes, blocks, run/choice/branch/sequence selectors, sticky/fallback options,
  call-return jumps, conditions + effects, visit counts, `{@ref}` interpolation, game events,
  tags, gameData merge-at-read, and whole-game save/load (`save_game` / `load_game`). No
  scene-tree types in the engine, so it also runs headless.
- Bundle loading: `PatterBundle.load_from_string(json)` from any `.patterc`.
- Localisation: play any locale of an Embedded bundle, switch live with `set_locale`, or ship
  an IDs-only bundle and localise in your own system. Closed-caption cue stripping via
  `set_closed_captions`.
- Audio resolution: `PatterAudio` resolves each line to its winning take from a
  `patteraudio.json` manifest (it resolves the path; playback stays yours).
- Live state: `PatterStatePanel`, an in-game overlay that watches and edits a running
  engine's `@patter` properties (type-aware editors + reset-to-default) and saves / loads
  the run.
- Live Link: `PatterDebugLink` streams the story cursor to Patterpad and hot-reloads edited
  bundles into the running game (`apply_live_bundle`: strings-only or full swap, state kept).
- Structure introspection: `get_outline()` / `get_beat_sequence()` expose the authored tree
  (per-beat text, character, gameData, tags) for tooling.
- Demos in `demo/`: a headless **play-through demo** (the minimal integration) and the
  **Tour scene** (the interactive Patter tour, with optional audio resolution).
