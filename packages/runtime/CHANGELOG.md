# Changelog

All notable changes to `@patterkit/runtime` (Patterplay JS) are documented here. The
Patterplay runtimes - JS, Unity, Unreal, and Godot - are versioned in lockstep: the same
version number always means the same runtime behaviour. This package is versioned by
`npm run bump:play`, not by Changesets.

## [Unreleased]

## [0.1.0] - Unreleased

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
