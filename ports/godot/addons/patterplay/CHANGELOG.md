# Changelog

All notable changes to Patterplay for Godot are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

### Added

- **The bundle inspector is back (#45), and this time an exported build is part of the test.** Select a
  `.patterc` in the FileSystem dock and the Inspector shows what your game code may call: identity and
  hashes, every scene and block address, the `@world` properties the game must supply (with the ones
  carrying no default marked), the story's own declarations, gameData fields, and counts.

  0.4.3 shipped this by importing `.patterc` as a Resource, which stopped the source file reaching an
  exported build and broke every shipped game; 0.4.4 removed it. What was missing was the other half:
  an export plugin now puts the raw bundle back at its own path and skips the imported product, so a
  build carries exactly the bytes it did before any of this, at the same size (measured: a 3.4 MB
  bundle gives a 3.6 MB pack, the same as 0.4.4, against 7.2 MB when the imported copy also ships).

  Two things worth knowing. `ResourceLoader.load("res://game.patterc")` works in the EDITOR and
  returns nothing in a build - the resource is an editor convenience, and a running game reads the
  file, as it always has. And the plugin now puts the bundle into the export itself, so the
  `*.patterc` entry in "filters to export non-resource files" is a safety net rather than a
  requirement - keep it if you have it, since it covers a disabled plugin, and it costs nothing.

  `ports/godot/test/export_check.sh` is the gate that was missing: it exports a project and RUNS the
  pack, in a directory with no project above it, because every other check here runs in the editor
  where the file is on disk whatever the addon does to it.

### Fixed

- **The plugin removes what it registers.** An `EditorPlugin` with no `_exit_tree` leaves Godot holding
  freed script instances and it aborts on shutdown. That was mine, found by the export gate.

## [0.4.4] - 2026-08-20

### Fixed

- **Exported builds could not find their bundle (#45, thanks @yukonmakesgames).** 0.4.3 registered an
  importer for `.patterc`, which turned it from a plain file into an imported RESOURCE: Godot then
  resolved `res://game.patterc` to `.godot/imported/game-<hash>.tres` and stopped shipping the source
  file, so `FileAccess.get_file_as_string("res://game.patterc")` read nothing in an exported build.
  Adding `*.patterc` to "filters to export non-resource files" could not help, because the file had
  stopped being a non-resource. The importer is off again and `.patterc` is a plain file, as it was
  before 0.4.3.

  **If you opened your project in 0.4.3**, delete the `*.patterc.import` files it left beside your
  bundles (and any matching entries under `.godot/imported/`). Godot leaves them in place and an
  export still follows them, so removing them is what actually restores your build.

  The bundle Inspector added in 0.4.3 goes with it: without the importer there is no asset for it to
  draw. The code is still in `addons/patterplay/editor/`, unregistered, and comes back when it can be
  turned on without changing how a bundle ships.

## [0.4.3] - 2026-08-19

### Added

- **The bundle inspector.** Select an imported `.patterc` and see what your game code may call, read
  from the asset alone with nothing running: the project's identity and hashes, every scene and block
  ADDRESS `runFlow` / `goto` accept, the `@world` properties the GAME must supply (with the ones
  carrying no default marked, because those are the values a story silently reads as a type default
  if the host forgets them), the story's own declarations, the gameData fields, and counts for "is
  this the right build?". A source-debug build says NOT SHIPPABLE rather than leaving it to be
  inferred from `strings: ids`.

  The summary itself is available to code as well (`PatterDescribe.describe_bundle`), so a build
  step or an editor tool can read the   same description the panel draws.

  Godot needed one more thing first: a `.patterc` was a plain file, and an EditorInspectorPlugin can
  only draw for a Resource. The addon now IMPORTS `.patterc` as a `PatterBundleResource`, so a bundle
  is a first-class asset in the FileSystem dock and selecting it shows the summary in the Inspector.
  A broken bundle still imports, carrying its diagnosis.

  **Nothing about loading a bundle at runtime has changed**: `FileAccess.get_file_as_string` into
  `PatterBundle.load_from_string` is still how the demo and the docs do it, and still works with the
  plugin disabled. The resource is for projects that would rather have the asset.

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
- **`PatterSave`: the tagged `patter/save@0` envelope** (parity with the JS and Unity save
  helpers): `serialize_state` / `deserialize_state` wrap `save_game()` in a schema-tagged envelope, so
  a foreign blob is refused instead of corrupting a run. The state panel now writes the envelope;
  `.patterstate` files written before this release (bare snapshots) still load.

### Fixed
- The download now includes the **MIT `LICENSE` file**; previously the zip shipped with no licence
  text at all.

## [0.3.1] - 2026-07-22

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
