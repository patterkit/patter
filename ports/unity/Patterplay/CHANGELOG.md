# Changelog

All notable changes to Patterplay for Unity are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

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
