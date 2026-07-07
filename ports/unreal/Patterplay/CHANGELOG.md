# Changelog

All notable changes to Patterplay for Unreal are documented here (the release zip also
carries the PatterplayDemo sample project). The Patterplay runtimes - JS, Unity, Unreal,
and Godot - are versioned in lockstep: the same version number always means the same
runtime behaviour.

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
