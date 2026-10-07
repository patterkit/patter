# Changelog

All notable changes to Patterplay for Godot are documented here. The Patterplay runtimes - JS,
Unity, Unreal, and Godot - are versioned in lockstep: the same version number always means the
same runtime behaviour.

## [Unreleased]

## [0.21.0] - 2026-10-07

### Changed

- **The conformance corpus covers more, and every runtime is held to it**: the outline and beat sequence, the
  audio resolver's joins, `listProperties`, what a checkpoint refuses while it is open, a save taken inside one,
  and a block named under another scene.

### Removed

- **Two unused helpers on `PatterBundle`**: `split_ref`, superseded by `split_ref_with`, and
  `host_scope_default`.

### Fixed

- **`list_properties` rows carry `values` and `stages` only where the declaration has them**, as every other
  runtime's rows do. Every row carried both, empty when undeclared; read them with `.get()`.
- **`get_outline` leaves out a scene's or block's `gameId` when it comes out empty**, as every other runtime
  does, rather than giving an empty string.

## [0.20.0] - 2026-10-06

### Added

- **`PatterFlow.reset()`**, as the other three runtimes have: it forgets the flow's own state and anything
  waiting to be delivered, and begins again at a scene (the first authored scene by default). A new corpus op,
  `resetFlow`, holds all four to it.
- **`PatterBundle.game_data_value`**, as the other runtimes have: one gameData field with its default applied.
- **`engine.on_trace(handler)`**, as the JS runtime has: each decision as it happens, with the flow it happened
  in, whether the log is on or off. It returns its own unsubscribe. An earlier entry here described `on_trace`
  before it existed.
- **`PatterDebugLink.state()`, `build()`, and `url()`**, the names every other runtime uses for what the link is
  doing.
- **`get_visit_counts()` on `PatterEngine` and `PatterFlow`**, as on every runtime: visit counts read without a
  save.

### Changed

- **The engine and its flows share a typed host rather than a dictionary.** Its fields are named after the JS
  runtime's, so a change there ports across line for line, and each one has a type, which the busiest paths now
  use. Nothing a game sees changes.
- **`PatterDescribe.describe_bundle` uses the same keys as every other runtime** (`structureHash`,
  `defaultLocale`, `sourceDebug`, `gameId`, `hostScopes`, `gameData`, `hasDefault`, and `gameEvents`), as every
  other result Dictionary in the addon already did, and carries a gameData field's `purpose`. Code that read the
  snake_case keys needs the new ones.
- **The corpus now holds the decision log to the same entries on every runtime.** Godot's already matched the JS
  runtime's entry for entry; the check makes sure it stays that way.
- **Absent is null, as on every other runtime.** `PatterAudioResolver.resolve` for a beat with no recording,
  `scene_address` and `block_address` for an unknown id, and a flow's `current_scene()` before it enters a scene
  now return null, not `""`. Code that compared them with `""` should compare with null;
  `PatterDebugLink.observe` takes either.
- **`apply_live_bundle`'s result carries the `bundle` now playing**, as every other runtime's does.
- **Less work per step.** A decision's log entry is built only while the log is on or something is tracing; a
  quality's stage ladder is looked up once rather than scanned for on every comparison; and the state logger
  reads visit counts directly rather than saving the whole game.

### Deprecated

- **`PatterFlow.start()` is deprecated: use `PatterFlow.reset()`.** They were the same call under two names.
  `PatterFlow.reset()` is the one public name for beginning a flow again on every runtime (opening a flow begins
  a new one); `PatterFlow.start()` goes in a later release.
- **Names that differed from every other runtime's now match them; the old names still work, and go in a later
  release.** `PatterBundle.game_data_fields` (was `game_data_fields_for`) and `PatterAudioResolver` (was
  `PatterAudio`).
- **`PatterDebugLink.status()`: use `state()`, `build()`, and `url()`.** It goes in a later release.

### Fixed

- **A restart (`start`) no longer replays a prompt from the run it abandoned.** With prompt replay on,
  `choose()` leaves the chosen option's prompt waiting for the next `advance()`. A restart (`start`) in between
  cleared only the choice, so the old prompt played as the restarted run's first beat. Every move that leaves
  the flow's place (a restart, `goto`, `close`) now drops both, through one helper.
- **The audio resolver keeps a base path that is a root.** It trimmed every trailing slash before adding its
  own, so a base of `"user://"` or `"res://"` lost its root and a take resolved to `user:/take.wav`. A base that
  ends in a slash is now joined as it stands.
- **`list_properties` reports each property's name as declared**, as every other runtime does, not lower-cased.
- **`describe_bundle` leaves out a field that isn't set**, as every other runtime's description does: a gameData
  field's `values` when it has none, a property's `default` when it has none, and the bundle's `version`,
  `hash`, or `structureHash` when it carries none. The conformance corpus now holds every runtime's description
  to the same fields.

## [0.19.0] - 2026-10-06

### Added

- **Content errors are reported through a new `on_error` engine option.** Content can fail at run time in ways the
  compiler cannot see: a division by zero, a host value of the wrong type, a story write to a read-only `@world`
  value. The story already played through each one; now it says so. `on_error` is a Callable that receives
  `{"flow", "kind", "node", "source", "message"}`, where `kind` is `"condition"`, `"effect"`, or `"best-match"`,
  `node` is the snippet, group, or option whose condition failed (or the snippet or scene owning the effect), and
  `source` is the expression's text when the bundle carries it. Left unset, each error is a `push_warning`, so a
  content bug is never silent. With `{"log": true}`, each is also a `diagnostic` entry in the decision log
  (`kind`, `node`, `source`, `message`), which the state panel shows under its own filter. The same rule holds on
  all four runtimes.

### Changed

- **An effect that fails is skipped, with no `write` entry, and the rest of its list still runs.** A story write
  to a read-only `@world` value now counts as a failed effect too, reported like the others. The log used to
  record a `write` for an effect that never landed.
- **A shuffle draws only from bag members that are still eligible.** The bag is filled from the children eligible
  on the first visit; a child whose condition has since gone false used to be drawn, and the group then played
  nothing. If none of the bag is eligible, the pass is over, exactly as when the bag is empty. While every bag
  member is still eligible, a seeded shuffle draws exactly as before.
- **One address rule for `open_flow`, `goto`, and every lookup by address.** A scene resolves by its gameId first,
  then by its internal id; `open_flow` used to try the internal id first, so it and `goto` could land in different
  scenes. A block resolves within its scene only, by that scene's block gameId and then by the internal id of a
  block in that scene. `tags_for_block`, `game_data_for_block`, and `cast_for_block` follow the same rule.
- **An option's prompt beat carries tags, like any beat.** Its own tags plus the option group's, outermost first
  and deduplicated. A replayed prompt (`replay_prompt_on_choose`) and the outline's prompt used to carry none.
- **A choice whose every remaining option is greyed out runs dry.** It used to be offered with nothing the player
  could take. It now behaves as a choice with no options: an eligible fallback follows if there is one, otherwise
  `on_dry_choice` fires and the flow moves on.
- **`load_game` checks a save before changing anything.** A save whose `flows` is missing or not an object is
  refused with `malformed save: no flows` and leaves the engine untouched. It used to close every flow and load
  the registry first, leaving the engine half-loaded. The version must be exactly 2 or 3.

### Removed

- **A bare snapshot with no `patter/save@0` envelope no longer loads.** `PatterSave.load_state` and
  `deserialize_state` used to accept a bare version 2 snapshot, from before the envelope existed. They now refuse
  it, as every other runtime does. A version 2 save inside the envelope still loads.

### Fixed

- **Expression kernel `k492cf234`:** a listener's own error is no longer reported as a read-only refusal, every
  listener registered when a write starts hears it exactly once (a listener whose object was freed is dropped),
  and the hot path allocates less, with no leaks.
- **A greyed-out choice option can no longer be chosen.** `choose()` accepted an option whose condition was
  false, played its content and used it up. It now reports `choice option is not eligible` and leaves the choice
  open, as the other three runtimes do.
- **A rollback after a load keeps a scene's saved `@scene` values.** After a load, a scene the flow is not
  standing in keeps its saved values waiting until the flow enters it. Entering it inside a checkpoint and then
  rolling back used to drop those values, so the next real entry found the defaults and the next save left them
  out. A new corpus case pins this on all four runtimes.
- **The decision log's `seq` keeps counting after a clear.** The engine's log numbered entries by its length, so
  after `clear_log()` the numbers started again at 0 and entries read either side of the clear could not be put
  in order.
- **The state panel's decision log updates as the game plays.** It was redrawn only when the panel rebuilt,
  which playing a flow never causes, so new decisions did not appear.

## [0.18.0] - 2026-10-05

### Changed

- **The `replay_prompt_on_choose` engine option speaks back only an authored prompt, and exactly what the choice showed.** A game that
  turns the option on will see the difference, which is why this is a minor release rather than a patch:
  - An option whose prompt the choice borrowed from its own first content line (a bare-snippet option,
    or an Option group with no prompt of its own) is no longer spoken back. That line used to play twice
    in a row, once as the replay and once as content. It now plays once.
  - The replayed prompt carries the text, `character`, `characterName`, and `direction` the choice
    displayed, instead of resolving the prompt again when it is delivered. So if choosing runs effects
    first (an Option group that picks a snippet runs its onEnter at once), or the language changes
    between `choose()` and the next `advance()`, the replay still says what the player saw. In a voiced
    project a replayed line prompt is now interpolated, as the choice showed it.
  - A save taken between `choose()` and the next `advance()` carries that prompt as shown, in a new
    optional `pendingPrompt` on the flow's cursor, so the replay after a load is the same. Every
    Patterplay runtime writes and reads it. A save from an earlier version, without it, still loads and
    resolves the prompt when it is delivered, as before.

### Fixed

- **A line whose `character` is set to `""` resolves the speaker's name like any other.** Its
  `characterName` comes from the `cast:` string for that token (active locale, then default), as on the
  other runtimes; it was always left out. Held across all four runtimes by the conformance corpus, which
  now also pins empty speaker fields on lines and option prompts, and plays cases with
  `replay_prompt_on_choose` and `closed_captions` set at construction.

## [0.17.0] - 2026-10-05

### Changed

- **A choice step carries its `groupId`, and each option a structured `prompt`.** The same shape the
  other three runtimes give: `prompt` is `{ "kind": "line" | "text", "text": ... }`, and a line prompt
  also carries `character`, `characterName`, and `direction` when set. The flat `"text"` on an option
  is gone, so read `option["prompt"]["text"]` instead. A save from an earlier version that is waiting
  at a choice still loads, its options in the new shape. Held across all four runtimes by the
  conformance corpus.

### Fixed

- **`open_flow` at an address that does not resolve opens nothing.** It reported the error and opened
  the flow anyway, closing any flow already open under that name. It now returns null (with
  `push_error`) before anything changes. The block must be in the scene you named, as `goto` has
  always required.
- **A flow you let go of is freed.** Every flow ever opened stayed in memory with its property bags,
  closed or not, and Godot reported leaked instances at exit for each one.

## [0.16.0] - 2026-10-04

### Added

- **Checkpoints: try something, then undo it.** `engine.checkpoint()` opens a checkpoint; `engine.rollback(checkpoint)` puts the game back exactly
  as it was then, and `engine.commit(checkpoint)` keeps everything. A rollback undoes every change the story made in between:
  property values in every scope (a game's own `@world` store is written back through the game), visit
  counts, shuffle and sequence positions, `@scene` bags made since, and every flow's position and random
  state; a flow opened since is closed, and its name is free again. `engine.in_checkpoint()` says whether one is open.
  The use is asking "would this say anything?" without consequences: move a flow to an address, step
  it, and roll back if it had nothing to give, so the scene's on-entry effects, the visits, and the
  shuffle draws never happened. Each change records how to undo itself as it happens, so a checkpoint
  costs what the steps inside it do, not what the game has built up, and the record is let go when it
  closes. One is open at a time; while it is, the calls a rollback couldn't undo are refused
  (`reset`, `load_game`, `hot_swap`, `close_flow`, `open_flow` over an open flow, and a flow's own `start` and `restore`, each reported with `push_error`). Held across all four runtimes by the conformance corpus.

### Fixed

- **`flow.restore()` on a running flow keeps that flow's own property values.** It used to drop them back to
  their defaults, since a snapshot holds a flow's position and memory, not its property values. Loading
  a save is unchanged.

## [0.15.0] - 2026-10-03

### Added

- **Scene and block gameData you can read at runtime.** `engine.game_data_for_scene(scene_ref)` and
  `engine.game_data_for_block(scene_ref, block_ref)` return the author's own gameData on a scene or a
  block, with refs resolved like the tag accessors (an internal id or a gameId address). The answer is
  the RAW sparse overrides, the same rule a beat's step follows: the project's declared defaults are
  not filled in (merge them with `PatterBundle.effective_game_data` when you want them), a block does
  not inherit its scene's gameData, and an unknown ref or a node that sets none gives an empty
  Dictionary. Each call returns a fresh copy. `get_outline()` scene and block entries carry the same
  `gameData`, omitted when empty. Held across all four runtimes by the conformance corpus.

## [0.14.3] - 2026-09-27

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  the JS runtime's zip, whose module builds now work without npm. Nothing in this runtime changed.

## [0.14.2] - 2026-09-27

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  the JS runtime's: `@wildwinter/scoperegistry` is now a peer dependency, so a game's install holds
  exactly one copy of the registry. Nothing in this runtime changed.

## [0.14.1] - 2026-09-27

### Changed

- Version bump only, to keep the four Patterplay runtimes in lockstep. The change in this release is
  the JS runtime's: it accepts any `@wildwinter/scoperegistry` from 0.7.0 up to 1.0, so an install no
  longer ends up with two copies of the registry. Nothing in this runtime changed.

## [0.14.0] - 2026-09-24

### Added

- **Other engines' scopes, with no setting.** A Patter line can name another engine's game-wide
  scope from the family's shared list (`@story.act` in a condition, an effect, or a `{@story.act}`
  slot) in any project. It is opaque to the compiler, recorded in the bundle (`externalScopes`, which
  `PatterBundle.load_from_string` checks and `PatterBundle.external_scopes(bundle)` reads), and never
  self-backed. Content that names one runs only where that engine is on the same registry: without
  it, `open_flow` and `load_game` refuse before anything changes, checking `externalScopes` in order
  and refusing on the first token the registry does not have, the way they refuse anything else
  (`push_error`, then `open_flow` returns null and `load_game` false) with the same message as every
  runtime: `this content names @story, which no engine on this registry registered: give every
  engine the game's one registry`. `load_game` checks right after the save version, so a refused
  load leaves every flow as it was. A write can still meet
  an unregistered scope when another engine takes its scope away mid-game: it fails in the registry
  naming the scope (`unknown scope '@story'`) instead of landing in `@patter` as a property called
  `story.act`.

### Changed

- **One registry per game.** Every property bag the engine holds now lives in a `PatterScopeRegistry`
  (the shared registry, vendored from `expr`): `@patter` under `patter`, and each flow's and scene's
  bag under a key starting `patter/`. A new `registry` option takes the game's own registry, shared
  with any other engine in the game; without one the engine makes its own and acts as its own game,
  so a single-engine game needs no change.
- **The save is version 3.** `save_game()` holds what is not a property (cursors, PRNGs, visit
  counts, selector cursors). An engine built without a registry also carries that registry's values
  under `registry`, so one `PatterSave.serialize_state` is still the whole game; an engine given the
  game's registry leaves them to the game, which saves the registry once (`registry.save()`). Version
  2 saves still load, their values moving into the registry, and so does the snake_case shape this
  addon wrote before 0.11.0.
- **`host_scopes` bindings are registered in the registry.** Each `{"get", "set"}` binding becomes a
  foreign scope: your game keeps the values, and no Patterplay save holds them. The option's shape is
  unchanged. A `writable: false` declaration is still refused to the story and never to your game's
  own `set_property`.
- **A self-backed `@world` is saved.** When the game binds no `host_scopes` entry, `@world` is a
  property the engine's registry stores, so it rides in the save. Given the game's registry, the
  engine self-backs nothing: `@world` is the game's to register there.
- **Every expression reads every registered scope**, so a condition can test another engine's
  `@story.act` in a combined game, even one registered after the flow opened, and `get_property`
  reads it too. A token two engines both want is refused as the second is built: the registry
  `push_error`s a message naming the first, the new engine's `init_error()` returns it and the engine
  is inert, and the game's registry is left as it was.
- `hot_swap` hands every bag to the replacement engine on the same registry. The engine it replaces
  is released and its flows are closed. If the restore is refused, the fallback engine keeps the
  shared properties and restarts each flow.
- `reset()` and a fresh `open_flow` drop values a load left waiting for this engine's keys, and no
  other engine's. Closing a flow removes its bags from the registry.
- `load_game()` returns `false` (with `push_error("unsupported save version: N")`) for a save it
  cannot read, and `PatterSave.load_state` / `deserialize_state` pass that on; both used to report
  success.
- `PatterStateLogger.snapshot_state` reads the engine's bags rather than its save. A scene no flow has
  re-entered since a load appears once it is.

### Added

- `PatterEngine.init_error()`: why construction was refused ("" when it was not), for an engine given
  a registry in which one of its tokens was already taken.
- **`PatterScopeRegistry`, the shared scope registry** (2026-09-24). A thin shim over `runtime/expr/scope_registry.gd`, vendored from expr and shared with the Storylet Engine: one registry per game, holding owned scopes (property bags it reads, writes, lists, and saves) and foreign ones (resolved by the game), and building the eval context the shared evaluator reads. It matches `@wildwinter/scoperegistry` 0.7.0 and runs that package's registry corpus: owners named in clash errors and carried on `list_properties()` rows, `remove(token, {"keep": true})`, values loaded for a key nobody has registered parked until it registers, `discard_parked(prefix)`, a `revision` counter, and aliases on `to_eval_context`. A refused call returns its error String ("" on success).

## [0.13.0] - 2026-09-05

### Changed

- **A `writable: false` host declaration is the STORY's promise, and only the story's: the game
  writes it.** The engine's own `set_property` now writes a read-only `@world` property, self-backed or bound;
  an effect that writes one is refused exactly as before, with the same sentence. Until now every
  caller was refused alike, so a game could not advance its own clock through the engine. Matches the
  JS reference and the Storylet Engine (from-storylets/host-writes-to-read-only-world).

## [0.12.1] - 2026-09-04

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
