# The state an engine shares with its flows: the bundle and its indexes, the game's registry, the
# shared halves of @patter and @scene, world-wide visits and selectors, the open checkpoint, and the
# presentation settings every flow reads live. Port of engine.ts's FlowHost interface; each field is
# the JS field's name in snake_case, so a change to the JS runtime ports across line for line. The
# few with no JS counterpart say why they exist.
#
# Loaded by path and declaring no `class_name`, because Godot registers those in a PROJECT-WIDE
# namespace: the type is internal, and every global name is one more that could collide in a game
# carrying both this addon and the Storylet Engine's. PatterEngine and PatterFlow each preload it as
# FlowHost.
#
# It holds no Callable that captures the engine or a flow. A lambda here would capture its maker,
# the host would hold the lambda, and the engine and every flow hold the host: a reference cycle
# that keeps them alive forever and makes the weak debug registry report a dead engine.
# test_debug_registry and test_flow_lifetime guard exactly that, which is why the engine log is a
# shared Array (see engine_log) rather than JS's emitEngine callback.
extends RefCounted

## The run's decision trace (engine.log()). Off unless asked for: a shipped game should pay nothing
## for a surface it never reads.
var log_enabled: bool = false
## Each declaration set's quality ladders, built on first use (see PatterFlow._ladders).
var quality_ladders: Dictionary = {}
## True when anything takes the decisions: the log, or an engine.on_trace handler. Flows skip building
## entries otherwise.
var tracing: bool = false
## The engine's live taps (engine.on_trace), each [id, handler]. The game's own Callables: nothing here
## closes over the engine, so they make no cycle.
var trace_handlers: Array = []
var next_trace_handler: int = 0
## Godot only, standing in for JS's emitEngine: the ENGINE's log Array itself, which a flow appends
## to directly, since a callback would have to close over the engine (see the top of this file).
var engine_log: Array = []
## Godot only, with engine_log: the next engine-log seq. Its own counter, since the log's size
## restarts after a clear; JS keeps it on the engine, behind emitEngine.
var engine_log_seq: int = 0
var bundle: Dictionary = {}
## IDs-only build (localisation mode "ids", no source-debug): the engine emits each beat's ID as its
## text and omits character display names, leaving localisation to the game.
var emit_ids: bool = false
var strings: Dictionary = {}
## The DEFAULT locale's string table: the fallback for a key the active locale is missing.
var default_strings: Dictionary = {}
## Cast canonical name -> authoring displayName (the unlocalised fallback when no loc string exists).
var cast_display: Dictionary = {}
var node_index: Dictionary = {}
## Block id -> the id of the scene it is in. JS maps to `{ sceneId }`; here the value is the id.
var block_index: Dictionary = {}
var block_by_id: Dictionary = {}
## Host-facing addresses (spec §6), shared with the engine: scene gameId -> internal id, and
## per-scene block gameId -> internal id. A flow needs them to resolve goto() by address.
var scene_game_id_to_id: Dictionary = {}
var block_game_id_to_id: Dictionary = {}
## Author tags (#215): node id -> accumulated tags (own + every ancestor's, deduped). Built once.
var tag_index: Dictionary = {}
## The game's one registry: `@patter` (the SHARED globals), host scopes, every instance bag. Held
## untyped: a combined game may hand over a registry another addon's shim built.
var registry = null
## True when the engine made the registry (a standalone game): save_game() then carries its values.
var owns_registry: bool = false
## The SHARED @patter globals' bag, registered under `patter`.
var patter_bag: PatterPropertyBag = null
## Host scopes this engine self-backed and registered (the game bound none, nobody else had). JS's
## name, which is why it is not the scopes the "host_scopes" option binds: the engine keeps those.
var host_scopes: Array = []
## Godot only: other engines' game-wide scopes the content names (the bundle's externalScopes),
## filtered once. Every one must be registered for a flow to open or a load to run, and each is a
## scope to PatterFlow.split_host_ref whether or not anybody registers it now. JS reads
## bundle.externalScopes in place.
var external_scopes: Array = []
## Decls for the shared @patter globals: (re)seed on engine.reset().
var patter_shared_decls: Array = []
## Decls for the per-flow @patter globals: seed each flow's own bag.
var patter_local_decls: Array = []
## Lowercase names of the SHARED globals (routes a @patter ref to engine vs flow), as a set.
var patter_shared_names: Dictionary = {}
## Per-scene set of SHARED @scene prop names (routes a @scene ref to stage vs flow).
var scene_shared_names: Dictionary = {}
## World-wide per-node entry counts (node id -> times entered by any flow).
var shared_visits: Dictionary = {}
## Shared selector cursors (node id -> selector state) for `shared` memoried selectors.
var shared_selectors: Dictionary = {}
## Per-scene SHARED scene props, each registered under PatterFlow.key_stage(sceneId). Made the first
## time any flow needs the scene, so a bag loaded before then waits in the registry and is claimed
## there.
var stage_bags: Dictionary = {}
## The open checkpoint's undo journal, or null when none is open (see PatterEngine.checkpoint()):
## { "undo": [Callable, ...] run newest first, "flows": {PatterFlow: true} whose cursor is already
## recorded (or opened inside the checkpoint), "opened": {PatterFlow: true} opened inside it,
## "selectors": {group id: true} shared selector cursors already copied, "flow_selectors":
## {PatterFlow: {group id: true}} each flow's own selector cursors already copied }. Untyped, since
## null is its "none".
var journal = null
## The game's "rng" option: a Callable every flow draws from instead of its own PRNG, or null.
var custom_rng = null
## Play a chosen option's prompt as its first beat (spec §5).
var replay_prompt_on_choose: bool = false
## Closed captions (#214): captions_on shows cues in dialogue lines (default true); when false the
## engine strips caption_open..caption_close spans from line text. Mutable via set_closed_captions.
var captions_on: bool = true
var caption_open: String = "["
var caption_close: String = "]"
## A cast member whose whole lines are captions (silent when off); default SFX.
var caption_character: String = "SFX"
## Diagnostics hook (opt-in, dev tooling): called with the choice's group id whenever a choice runs
## dry, no takeable option and no eligible fallback, so the silent fall-through is observable. The
## game's Callable as given, or null. Live feedback, distinct from the log's `dry` entry.
var on_dry_choice = null
## Content errors the engine played through (a condition that failed and counted as false, an effect
## that failed and was skipped, a Best-match part that failed and scored as false): the game's
## Callable as given, taking {flow, kind, node, source?, message}, or null. Unset, each is
## push_warning'd, so a content bug is never silent. JS folds that default into onError itself.
var on_error = null
## Memoised ref splits (ref -> [scope, name]). A split depends only on the registry's scope set, so
## the cache is dropped whenever that moves (ref_split_revision).
var ref_split_cache: Dictionary = {}
var ref_split_revision: int = -1
