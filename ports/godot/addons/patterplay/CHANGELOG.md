# Changelog

All notable changes to Patterplay for Godot are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

### Changed

- **This addon needs Godot 4.4 or newer, and is verified on 4.7.** The floor was never stated
  ("Godot 4.x") and never tested: CI gated on 4.3, where the tour demo did not even parse, because it
  calls `AudioStreamWAV.load_from_file` (4.4+). Godot parses every script in a project when the
  project OPENS, so on 4.3 that one demo file took the whole project with it - addon, runtime, and
  the author's own game. Now the floor is stated, the gate is the current stable, and a CI step
  parses every script in the addon one at a time so the claim cannot drift again. Verified on real
  4.4 and 4.7 engines; on 4.3 the demo still will not parse, which is what a floor means.

## [0.12.0] - 2026-09-04

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  the JS runtime's: `patterplay.min.js`, the browser drop-in, is now built by `@patterkit/play-helpers`
  and carries the play helpers (save / load, state logger, inspectors, Live Link) as well as the
  runtime on the one `Patterplay` global, so a plain web page can write the family's save text with
  no bundler. This plugin is unchanged; a save it writes still loads there and back.

## [0.11.0] - 2026-09-03

### Fixed

- **A `writable: false` host declaration is refused by the engine, bound or self-backed.** The addon let a
  bound scope's `set` Callable straight through, so the story's own promise held only for the self-backed
  bag; now the write is refused with `push_error("'@world.x' is read-only")` and no write from either, as
  the JS runtime always has. Pinned in `test_corpus.gd` (from-storylets/unreal-wrapper-host-scopes).

### Changed

- **Saves cross engines.** The addon now writes and reads the family's `patter/save@0` shape - the JS
  reference's, documented in `@patterkit/model` - so a save written by a web build or by Patterpad loads
  here, and a save written here loads in Unity or Unreal. Until now it wrote snake_case keys
  (`shared_visits`, `stage_bags`) with the cursor fields flat, which loaded nowhere else, and a JS save
  died here on its first key. **A save written by this addon before 0.11.0 still loads** and is written
  back in the shared shape. `test_save_shape.gd` pins the shape from both sides, and the conformance
  corpus now carries a save the JS reference wrote, which this addon must load, write back with the same
  key paths, and continue (from-storylets/save-shape-across-engines).

## [0.10.0] - 2026-09-02

### Added

- **`list_bags()` on the engine and on a flow, and `flows()` on the engine.** What a state
  logger mounts; `flows()` was missing here entirely, where the JS runtime has always had it.

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

### Fixed

- **A declaration with an explicit `null` default seeds the type's default.** Two halves of
  one rule disagreed: the seeding read the key directly, where `default_for` treats null and
  absent alike, so a `number` could hold nil. Unreachable from an exported bundle; a
  hand-written or third-party one could do it.

## [0.9.0] - 2026-09-02

### Changed

- **BREAKING: `list_properties()` rows say `"path"` where they said `"ref"`, and now carry `"name"`
  and `"writable"`.** The shape is `@wildwinter/scoperegistry`'s property row, shared with the
  Storylet Engine. `"path"` holds exactly what `"ref"` held: the reference `get_property` and
  `set_property` take. Reading a row's address means `row["path"]` now.
- **BREAKING: a row's address is the qualified one, `@patter.gold`, not `@gold`.** Both forms
  have always resolved on input and still do - an unqualified name defaults to the `patter`
  scope - so `get_property("@gold")` is unaffected. What changed is the address a row REPORTS,
  which is what a state panel displays and what an inspector writes back through. It matches
  what `@scene` and the other family's scopes have always looked like.

- **Scene and stage state is held in the shared property bag.** `@scene` properties lived in
  hand-rolled maps that duplicated the bag's own seeding, so they missed its guards: two flows
  entering one scene now never share a mutable flags list, and a `temporary` property's reset on
  re-entry goes through the bag, which means a state logger sees it. **The save format is
  unchanged** - a flat name/value map per scene, and a load that seeds from the bundle's
  declarations before laying saved values over, so a property a save predates keeps its default.

### Added

- **A decision log, and `on_dry_choice`.** Opening a run with `{"log": true}` records what the engine
  decided and why - each choice with the options it offered, the ones it greyed out and the
  reason, each jump, each property write with the value it replaced. `log()` is the whole
  run in order, a `Flow`'s own log is flow-local, and `on_trace` streams entries live rather than
  retaining them. `on_dry_choice` fires when a choice runs dry - no takeable option, no eligible
  fallback - so the silent fall-through is observable; it survives alongside the log because it is
  live feedback, not a record.

### Fixed

- **A quality row carries its ladder.** `stages` was on the row so an examiner could offer the
  stages instead of a free-text box, and the code that builds rows never filled it in - on this
  runtime and two others. Every quality row came out without one.

## [0.8.0] - 2026-09-01

### Removed

- **BREAKING: `Mulberry32` is now `PatterMulberry32`.** It was the one class in
  this addon without a `Patter` prefix, and `class_name` registers in Godot's
  PROJECT-WIDE namespace: a bare `Mulberry32` collided with any other addon, or
  your own code, that wanted the name. If you used `Mulberry32` directly, rename
  it; nothing else in the addon exposed it.

### Changed

- **BREAKING: the evaluator now REFUSES a bad expression instead of returning a
  fallback value.** `PatterExpr.evaluate` previously called `push_error()` and
  returned `0.0` for a division by zero or a mixed-type `+`, `false` for an
  unknown operator, and silently coerced any non-number to `0.0` (so `"a" < "b"`
  answered false). It now returns a `PatterExpr.EvalError`, which callers test
  with `PatterExpr.is_error(v)`, matching what the JS, Unity and Unreal runtimes
  have always done.

  A condition that errors is now ineligible rather than quietly false, and its
  diagnostic is reported. Content that leant on the old fallbacks will behave
  differently, and in every case we found the new behaviour is the one the other
  three runtimes already gave.

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

### Added

- **`PatterDialect`**: the built-ins (`random`, `check_flags`, `set_flags`,
  `visits`, `seen`, `patter_visits`, `patter_seen`) split out of the evaluator, so
  the evaluator is configured by a dialect rather than fusing one. This is what
  lets Patterplay and the Storylet Engine run the same evaluator source.
- **`PatterSpecificity`**: the matched-constraint scorer, previously inline in
  `flow.gd`.

### Fixed

- **The PRNG seed is coerced the way JavaScript coerces it** (ECMA-262 ToUint32),
  so every runtime lands on the same first draw for every seed. Seeds outside the
  range of a 64-bit integer (`1e19`, `Infinity`) previously gave a different
  answer here from the JS runtime.
- **Numbers render the way JavaScript's `String(n)` renders them.** `js_number`
  used a 1e15 cutoff and `String.num`'s 14-decimal default, so `0.1 + 0.2` showed
  as `0.3`, `1e16` as `10000000000000000.0` with a trailing `.0`, and `1/3` lost
  two digits. `NAN` printed as `nan`. This is visible wherever a number reaches
  displayed text through `{@ref}` interpolation.
- **An effect whose value does not evaluate now writes nothing.** It previously
  stored the evaluator's fallback (`0.0`, or `false`) into the property, which is
  a corrupted save rather than a caught bug.
- **`==` between a whole number and a float.** `3` and `3.0` compared unequal;
  the reference has one number type, so they are the same value.


## [0.7.1] - 2026-08-30

### Added

- **The state panel says whether Patterpad is listening.** A Live Link registered with
  `PatterDebug.register_link(link)` shows its state (connecting / connected / closed), the address it
  dials and the build it handshook. From inside a running game, "the editor is not listening" and
  "I never attached" look identical, and only the game knows which.

### Fixed

- **The debug registry no longer keeps a dead engine alive.** `PatterDebug` held engines strongly, so an engine your game replaced - a restart, a scene change, a live bundle swap - stayed in memory with its whole compiled story unless you remembered to `unregister` it. It holds weakrefs now, and `PatterDebug.engines` hands back only live ones.

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
  its flows underneath the wrapper. GDScript is reference counted and never had that fault.

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
  `engine.get_cast()`, `engine.cast_for_scene(scene_ref)`, `engine.cast_for_block(scene_ref, block_ref)`.

## [0.4.5] - 2026-08-20

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
  file, as it always has. And **you no longer need the export-filter setting for your bundle**: the
  plugin adds it to the export itself, verified through a GUI export with the filter box empty.
  Leaving `*.patterc` in there is harmless and still covers a disabled plugin. `patteraudio.json`
  and any other loose runtime files are still yours to add.

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
