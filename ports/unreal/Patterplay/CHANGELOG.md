# Changelog

All notable changes to Patterplay for Unreal are documented here (the release zip also
carries the PatterplayDemo sample project). The Patterplay runtimes - JS, Unity, Unreal,
and Godot - are versioned in lockstep: the same version number always means the same
runtime behaviour.

## [Unreleased]

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
