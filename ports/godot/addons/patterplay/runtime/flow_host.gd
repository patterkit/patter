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
## Speaker qualifier gameId -> authored name (the unlocalised fallback when no loc string exists).
var qualifier_display: Dictionary = {}
## A character's own label with a qualifier, for the overridden pairs only (the unlocalised fallback):
## cast name -> {qualifier gameId -> label}. JS keys one Map by `<name>\0<gameId>`; here it nests. A pair
## not here follows the pattern, whatever a loc file holds for it.
var speaker_labels: Dictionary = {}
## The project's speaker pattern (the unlocalised fallback for the `speaker:pattern` string).
var speaker_pattern: String = PatterBundle.DEFAULT_SPEAKER_PATTERN
var node_index: Dictionary = {}
## Block id -> the id of the scene it is in. JS maps to `{ sceneId }`; here the value is the id.
var block_index: Dictionary = {}
var block_by_id: Dictionary = {}
## Every beat by its id: a snippet's beats and an option's prompt, for PatterFlow.step_for. Built once
## (PatterEngine._index_nodes), like the other structural indexes. JS caches one per bundle (beatIndexFor).
var beat_by_id: Dictionary = {}
## Each option of a choice, by its id, to the id of the choice it belongs to: a save stamps the frame an
## option's content runs in with its choice (`choiceId`). Built once with the other indexes. JS caches one
## per bundle (optionChoiceFor).
var option_choice: Dictionary = {}
## Host-facing addresses (spec §6), shared with the engine: scene gameId -> internal id, and
## per-scene block gameId -> internal id. A flow needs them to resolve goto() by address.
var scene_game_id_to_id: Dictionary = {}
var block_game_id_to_id: Dictionary = {}
## Author tags (#215): node id -> accumulated tags (own + every ancestor's, deduped). Built once.
var tag_index: Dictionary = {}
## Line padding: every line and text beat's resolved pause, beat id -> {"resolved", "own" when set}.
## Built once (PatterBundle.build_pad_index).
var pad_index: Dictionary = {}
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
## Problems the engine reported and carried on past (a condition that failed and counted as false, an
## effect that failed and was skipped, a Best-match part that failed and scored as false, how the engine
## was set up, a load whose place has gone): the game's Callable as given, taking {flow, kind, node,
## source?, message}, or null. Unset, each is push_warning'd, so none is ever silent. JS folds that
## default into onError itself; here report() does.
var on_error = null
## Saved values a load put back to their defaults because they no longer fit their declarations (a stage,
## an enum value or a flag deleted since the save, or a value of another type): the game's Callable as
## given, taking an Array of {scope, name, value}, or null. Unset, each is push_warning'd, so a drifted
## save is never silent. JS's onRefit.
var on_refit = null


## Report a problem the engine carried on past (a PlayError: {flow, kind, node, source?, message}) to the
## game's on_error, or push_warning when it set none, so none is ever silent. The log's diagnostic entry
## is the caller's: a flow emits its own, and the engine emits a set-up report through emit_engine.
func report(err: Dictionary) -> void:
	if on_error is Callable and (on_error as Callable).is_valid():
		(on_error as Callable).call(err)
		return
	var kind := str(err.get("kind", ""))
	if kind == "setup":
		push_warning("Patterplay: %s" % err["message"])
	elif kind == "save":
		push_warning("Patterplay: flow '%s': %s" % [err["flow"], err["message"]])
	else:
		push_warning("Patterplay: %s on %s in flow '%s' failed, played through: %s" % [kind, err["node"], err["flow"], err["message"]])


## An entry in the engine's log that belongs to no flow's (a set-up report, whose flow is ""): to
## the engine log when it is on, and to every on_trace handler. JS's emitEngine for a flowless event;
## a flow's own entries go through PatterFlow._emit, which writes here too.
func emit_engine(flow_id: String, event: Dictionary) -> void:
	if not tracing:
		return
	var wide := event.duplicate()
	wide["flow"] = flow_id
	if log_enabled:
		wide["seq"] = engine_log_seq
		engine_log_seq += 1
		engine_log.append(wide)
	for h in trace_handlers.duplicate():
		h[1].call(flow_id, wide)


## Say what the registry's refitting loads have put back since it last said (EngineOptions.onRefit):
## after a load, a flow's restore, and each bag that claims saved values.
func report_refits() -> void:
	# A game's registry from an older addon's copy of the kernel has no refit to report.
	if registry == null or not registry.has_method("take_misfits"):
		return
	# This engine's own keys only: the game's registry may hold other engines' and the game's misfits.
	var misfits: Array = registry.take_misfits(func(scope: String) -> bool:
		return scope == "patter" or scope.begins_with("patter/") or host_scopes.has(scope))
	if misfits.is_empty():
		return
	if on_refit is Callable and (on_refit as Callable).is_valid():
		(on_refit as Callable).call(misfits)
		return
	for m in misfits:
		push_warning("Patterplay: the save's %s.%s was %s, which no longer fits its declaration; it is back at its default"
			% [m["scope"], m["name"], JSON.stringify(m["value"])])
## Memoised ref splits (ref -> [scope, name]). A split depends only on the registry's scope set, so
## the cache is dropped whenever that moves (ref_split_revision).
var ref_split_cache: Dictionary = {}
var ref_split_revision: int = -1
