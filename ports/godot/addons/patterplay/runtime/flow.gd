# PatterFlow - one playable flow: its execution cursor (a continuation stack of block / run-group
# positions), the not-shared half of @patter / @scene, a serialisable PRNG, per-flow visit + selector
# state. Port of engine.ts's Flow (via the corpus-verified C#/C++ ports). advance() returns a normalised
# step Dictionary (line / text / gameEvent / choice / end), the same shape the conformance transcript pins.
class_name PatterFlow
extends RefCounted

## The owner label on everything the engine registers in the game's registry: named in a clash
## error and carried on the registry's examiner rows, so one inspector can group a combined game by
## engine. The same on every runtime.
const OWNER := "Patter"

const FlowHost := preload("res://addons/patterplay/runtime/flow_host.gd")

var id: String
## The state this flow shares with its engine and the engine's other flows; see flow_host.gd.
var _host: FlowHost
var _local   # PatterPropertyBag: this flow's not-shared @patter half, registered under key_flow_globals
var _scene_bags: Dictionary = {}
## The registry keys this flow has registered (its globals and each scene bag), in order.
var _registered: Dictionary = {}
## The eval context's scopes are rebuilt from the registry only when its revision moves.
var _ctx_revision := -1
var _registry_qualities = null   # the registry context's quality lookup, or null when none
var _prng := PatterMulberry32.new(0)  # the seeded PRNG; its `a` is the saved rng_state

var _started := false
var _flow_ended := false
## The choice that last ran dry, while nothing has been delivered since: if the flow ends with it set,
## it ended because that choice ran dry. "" = none.
var _dry_choice := ""
## The choice whose running dry ended this flow, once it has (the end step's reason "ran-dry"); saved.
## "" = none.
var _ran_dry := ""
# Closed by the engine (see close()). Terminal, and distinct from _flow_ended: an ENDED flow is
# merely out of content and goto() revives it; a CLOSED one is finished for good.
var _closed := false
var _current_scene_id := ""           # "" = none
var _stack: Array = []                # of { "scene":, "container":, "index": }
var _active_snippet = null            # node Dictionary or null
var _beat_index := 0

## This flow's decision trace; see log(). `_seq` is monotonic and survives clear_log().
var _log: Array = []
var _seq := 0
## The pending choice, or null: { "group_id":, "options": [{"id", "eligible", "gameData"?}] (what a save
## keeps; no prompts, which are built in the language in use each time the choice is delivered),
## "by_id": {id: node}, "shown": {id: prompt or null} (each prompt as last delivered, for a replay to
## speak exactly what the player saw) }.
var _pending = null
var _pending_prompt_beat = null       # replay_prompt_on_choose: the chosen option's authored prompt beat Dictionary, or null
var _pending_prompt_shown = null      # ...that prompt as the choice showed it; null only after loading a save that did not carry it
var _pending_prompt_owner: String = "" # chosen option owning _pending_prompt_beat, found again across a save in the choose->advance window
var _selectors: Dictionary = {}
var _visit_counts: Dictionary = {}
var _eval_ctx: Dictionary
var _dialect: Dictionary = PatterDialect.dialect()
## Why the last advance() or choose() was refused, or "" when it wasn't: see last_error().
var _last_error := ""


func _init(host: FlowHost, seed_value: float) -> void:
	_host = host
	_prng = PatterMulberry32.new(seed_value)
	_local = _fresh_local()   # registered by _begin() / restore()
	# Every entry is a METHOD Callable, never a lambda. A lambda that reads a member holds this flow
	# strongly, and the flow holds the context, so a flow that built one was never freed, closed or
	# not. A method Callable names the flow without keeping it alive.
	_eval_ctx = {
		"scopes": {},   # filled from the registry by _context()
		"next_random": _rng,
		"visits": _own_visits,
		"patter_visits": _shared_visits,
		# The quality channel: a property's stage ladder, from wherever the declaration lives -
		# @patter decls, the CURRENT scene's decls (they move with the flow), or the registry.
		"qualities": _stages_for,
	}


# The eval context is built once and REFRESHED only when the registry's set of scopes moves (its
# revision): every constituent resolves live state at call time (bags mutate in place; @patter and
# @scene route through this flow's resolvers, which read the current bags and scene), but another
# engine registering `@story` after this flow opened must still be readable.
#
# `@patter` and `@scene` each span a shared bag and a per-flow bag, split by each property's `shared`
# flag, so the flow composes those two tokens itself over its registered bags; one alias names one
# key and cannot express that. Every other token is the registry's.
func _context() -> Dictionary:
	var reg = _host.registry
	if reg.revision != _ctx_revision:
		var base: Dictionary = reg.to_eval_context()
		var scopes: Dictionary = (base.get("scopes", {}) as Dictionary).duplicate()
		scopes["patter"] = _patter_get   # method Callables, not lambdas: see _init
		scopes["scene"] = _scene_get
		_eval_ctx["scopes"] = scopes
		_registry_qualities = base.get("qualities")
		_ctx_revision = reg.revision
	return _eval_ctx


func _own_visits(nid):
	return _visit_counts.get(nid, 0)


func _shared_visits(nid):
	return _host.shared_visits.get(nid, 0)


## The scene the flow is in, or null before it enters one, as on every other runtime.
func current_scene():
	return null if _current_scene_id == "" else _current_scene_id


# The stage ladder of "@scope.name" when it is a declared quality, else null. Names compare
# lowercase, as the compiler emits references. Mirrors the JS Flow.stagesFor.
func _stages_for(scope: String, name: String):
	var key := name.to_lower()
	if scope == "patter":
		return _ladders("patter", func(): return _host.patter_shared_decls + _host.patter_local_decls).get(key)
	if scope == "scene":
		if _current_scene_id == "" or not _host.bundle["scenes"].has(_current_scene_id):
			return null
		var scene_id := _current_scene_id
		return _ladders("scene/" + scene_id, func(): return _host.bundle["scenes"][scene_id].get("sceneProps", [])).get(key)
	# Any other scope's ladder is the registry's (another engine's `@story`, the game's `@world`),
	# with the bundle's own host-scope declarations behind it for a game that registered `@world`
	# undeclared.
	if _registry_qualities is Callable:
		var hit = (_registry_qualities as Callable).call(scope, name)
		if hit != null:
			return hit
	return _ladders("host/" + scope, func():
		for spec in _host.bundle.get("scopeRegistry", {}).get("scopes", []):
			if spec.get("token", "") == scope:
				return spec.get("declarations", [])
		return []).get(key)


# The stage ladder of each declared quality in one set of declarations, by lowercased name (the first
# declaration of a name wins). Built once per set and kept on the host: a comparison asks for a ladder
# every time it runs, and scanning the declarations each time cost a pass and a lowercasing per
# declaration per comparison.
func _ladders(cache_key: String, decls: Callable) -> Dictionary:
	return ladders_on(_host, cache_key, decls)


static func ladders_on(host, cache_key: String, decls: Callable) -> Dictionary:
	var found = host.quality_ladders.get(cache_key)
	if found == null:
		found = {}
		for d in decls.call():
			var k := str(d.get("name", "")).to_lower()
			if d.get("type", "") == "quality" and d.has("stages") and not found.has(k):
				found[k] = d["stages"]
		host.quality_ladders[cache_key] = found
	return found


# Advance repeatedly, collecting every played beat, until a choice or the end - the "play to the next
# stop" a host's play UI / tooling wants. Returns { "played": [step,...], "stop": step }, where stop is
# the terminal choice / end. Termination is guaranteed (each advance() makes progress, or _settle()
# errors on a contentless jump cycle).
func advance_to_stop() -> Dictionary:
	var played: Array = []
	while true:
		var r: Dictionary = advance()
		var t: String = r.get("type", "end")
		if t == "choice" or t == "end":
			return {"played": played, "stop": r}
		played.append(r)
	return {"played": played, "stop": {"type": "end", "reason": "ended"}}


# Send this flow's cursor to an ADDRESS, exactly as an authored `go` jump would: the target scene's
# onEntry runs, entering counts as a visit, and the callstack is REPLACED (pending call-returns
# discarded). `scene`/`block` are host-facing gameIds (spec §6) or internal ids; `block` is scene-scoped.
# "END" ends the flow. HOST navigation, so it lands IMMEDIATELY: the rest of the snippet being delivered
# is abandoned and a pending choice dropped. An unstarted flow starts here; an ended one resumes.
# Returns false - cursor untouched - if the address does not resolve. MOVES, never resets.
func goto(scene: String, block: String = "") -> bool:
	if _closed:
		return false  # closed is terminal: unlike "ended", a goto cannot revive it
	_touch()
	if scene == "END":
		_started = true
		_clear_pending()
		_active_snippet = null
		_beat_index = 0
		_flow_ended = true
		_stack = []
		_dry_choice = ""
		_ran_dry = ""   # the host ended it: "ended", whatever ran dry before
		return true
	# Resolve BOTH addresses before touching state, so a bad one is a no-op rather than a half-move.
	var scene_id := resolve_scene(_host, scene)
	if scene_id == "":
		return false
	var block_id: String = ""
	if block != "":
		block_id = resolve_block(_host, scene_id, block)
		if block_id == "":
			return false  # a block address is scene-scoped: unknown HERE is unknown
	if not _started:
		if _start_refused():
			return false
		_begin(scene_id, block_id)
		return true

	_clear_pending()
	_active_snippet = null
	_beat_index = 0        # abandon the rest of the snippet being delivered
	_flow_ended = false    # an ended flow resumes at the target
	_dry_choice = ""
	_ran_dry = ""
	_enter_target(block_id if block_id != "" else scene_id, "jump")  # replace the stack, like an authored goto
	_settle()
	return true


# Finish this flow for good. Engine-managed (close_flow, reset, and the open_flow replace path). A
# dropped flow used to stay fully live, so a host still holding it could keep advancing it and move
# shared state. Closing makes that stale reference inert. Terminal: never revived. Its bags leave the
# registry with it.
func close() -> void:
	_release_bags(false)
	_closed = true
	_flow_ended = true
	_stack = []
	_active_snippet = null
	_beat_index = 0
	_clear_pending()


## Drop everything waiting to be delivered: an open choice, and a chosen option's prompt still to be
## replayed. Every move that abandons the flow's place (reset, goto, close) does this, so none leaves a
## stale prompt behind. start() cleared only the choice, so a restart between choose() and the next
## advance() replayed the abandoned run's prompt as the new run's first beat.
func _clear_pending() -> void:
	_pending = null
	_pending_prompt_beat = null
	_pending_prompt_shown = null
	_pending_prompt_owner = ""


# True once the engine has closed this flow.
func is_closed() -> bool:
	return _closed


## Inside a checkpoint, the first change to this flow records its cursor and PRNG, so a rollback can
## put them back: a handful of fields and a copy of the call stack (a few frames), never its history.
## Its visits, selector cursors, and property values are recorded change by change as they happen.
func _touch() -> void:
	var journal = _host.journal
	if journal == null or journal["flows"].has(self):
		return
	journal["flows"][self] = true
	var frames: Array = []
	for f in _stack:
		frames.append((f as Dictionary).duplicate())   # frames advance in place (index += 1), so copy them
	journal["undo"].append(_put_cursor_back.bind([_prng.a, _started, _flow_ended, _current_scene_id,
		_active_snippet, _beat_index, _pending, _pending_prompt_beat, _pending_prompt_owner, frames, _pending_prompt_shown,
		_dry_choice, _ran_dry]))


## The undo of _touch(): the cursor fields and the stack as they were when the checkpoint first saw this flow.
func _put_cursor_back(c: Array) -> void:
	_prng.a = c[0]
	_started = c[1]
	_flow_ended = c[2]
	_current_scene_id = c[3]
	_active_snippet = c[4]
	_beat_index = c[5]
	_pending = c[6]
	_pending_prompt_beat = c[7]
	_pending_prompt_owner = c[8]
	_stack = c[9]
	_pending_prompt_shown = c[10]
	_dry_choice = c[11]
	_ran_dry = c[12]


## Starting resets this flow's property bags, which a rollback can't put back: only a flow opened
## inside the checkpoint may start in one. True (with push_error) when this start is refused.
func _start_refused() -> bool:
	var journal = _host.journal
	if journal == null or journal["opened"].has(self):
		return false
	push_error("a flow can't be started or reset while a checkpoint is open")
	return true


# The options of the choice currently waiting for the player, or [] when none is pending. The same
# list the `choice` step carries - re-readable, e.g. after restoring a save.
## This flow's decisions, in order. Empty unless the run was created with {"log": true}.
## The engine's log carries the same events tagged with the flow; this one is what a single
## conversation reads as.
func log() -> Array:
	return _log


## Drop the retained entries. `seq` keeps counting, so order survives a clear.
func clear_log() -> void:
	_log.clear()


## Record one decision, on this flow's log and the engine's. Cheap with logging off: the
## entry is never built.
func _emit(event: Dictionary) -> void:
	if not _host.tracing:
		return
	var scene = _current_scene_id if _current_scene_id != "" else null
	var entry := event.duplicate()
	if scene != null:
		entry["scene"] = scene
	var wide := entry.duplicate()
	wide["flow"] = id
	if _host.log_enabled:
		entry["seq"] = _seq
		_seq += 1
		_log.append(entry)
		# The engine's stream is the same Array instance, appended to directly: a callback
		# would have to close over the engine, and that cycle is what test_debug_registry
		# refuses. Each entry names its flow, since a run is several flows in one order.
		wide["seq"] = _host.engine_log_seq
		_host.engine_log_seq += 1
		_host.engine_log.append(wide)
	# A copy: a handler may unsubscribe itself, or another, while being called.
	for h in _host.trace_handlers.duplicate():
		h[1].call(id, wide)


## How many times this flow has entered each node, by node id. A copy.
func get_visit_counts() -> Dictionary:
	return _visit_counts.duplicate()


## The step this flow would deliver for beat `beat_id` right now, as advance() would give it: its text in
## the active locale, interpolated against this flow's values (unless the project is voiced), closed
## captions applied, and the speaker's names and label, its pause, Game Data, extension values, and tags.
## Built by the same function that builds a delivered step, so the two can't differ. It doesn't move the
## flow, count a visit, or run an effect. Null for an id that is neither a beat nor an option's prompt.
## For a game that keeps lines by id and shows them again (after a load, or a language switch). JS:
## Flow.stepFor.
func step_for(beat_id: String):
	var beat = _host.beat_by_id.get(beat_id)
	return _beat_result(beat) if beat != null else null


## The options of the pending choice ([] when not at a choice point), their prompts built in the language
## in use, as advance() delivers them.
func get_choices() -> Array:
	return _offer() if _pending != null else []


## Why the last advance() or choose() was refused (also push_error'd), or "" when it wasn't: a flow that
## hasn't started, no choice pending, an unknown or greyed option, a jump to nowhere, or a jump cycle
## that never settles. Set on a refusal and cleared by the next of those calls that succeeds. GDScript
## can't throw, so a refused advance() returns {"type": "end", "reason": "ended"} and says why here.
func last_error() -> String:
	return _last_error


## Refuse the call under way: push_error the message and keep it for last_error().
func _refuse(message: String) -> void:
	_last_error = message
	push_error(message)


## The pending choice's options as the game is handed them: each prompt built now, in the language in use
## and against the current values (and remembered, for a replay to speak as shown), and the game's own copy
## of each option's gameData. Extension values are the bundle's own, read-only by contract.
func _offer() -> Array:
	var out: Array = []
	for o in _pending["options"]:
		var node: Dictionary = _pending["by_id"][o["id"]]
		var opt := {"id": o["id"], "eligible": o["eligible"]}
		var prompt = _prompt_for(node)
		_pending["shown"][o["id"]] = prompt
		if prompt != null:
			opt["prompt"] = prompt
		if o.get("gameData") is Dictionary:
			opt["gameData"] = _norm_gamedata(o["gameData"])
		_put_extensions(opt, node)
		out.append(opt)
	return out


func is_ended() -> bool:
	return _flow_ended


# -- host API ------------------------------------------------------------------

## Forget everything in this flow and begin again: its per-flow state (not-shared @patter globals and
## @scene props), cursor, call stack, selector cursors, visit counts, and anything waiting to be delivered.
## Shared state is untouched. The one public way to begin a flow again (open_flow begins a new one), as
## Flow.reset is on every runtime.
func reset(scene_id: String = "", block_id: String = "") -> void:
	_begin(scene_id, block_id)


## Begin this flow at a scene (empty: the bundle's start, else the first authored scene), and optionally
## a block within it. The engine's own entry point: open_flow and a goto on an unstarted flow begin a flow
## here. A game calls reset().
func _begin(scene_id: String = "", block_id: String = "") -> void:
	if _start_refused():
		return
	# No scene named: the project's start, when the bundle carries one; else the first scene, below.
	# A start naming a scene, or block, the bundle doesn't have (only a hand-edited bundle can) is passed over.
	var start = _host.bundle.get("start")
	if scene_id == "" and block_id == "" and start is Dictionary and _host.bundle["scenes"].has(str(start.get("scene", ""))):
		scene_id = str(start["scene"])
		var start_block = start.get("block")
		if start_block != null and str(_host.block_index.get(str(start_block), "")) == scene_id:
			block_id = str(start_block)
	# A start is a reset: this flow's bags go, and so does anything a load left waiting for them.
	_release_bags(false)
	_host.registry.discard_parked(key_flow(id))
	_mount_local()
	_selectors = {}
	_visit_counts = {}
	_stack = []
	_current_scene_id = ""
	_flow_ended = false
	_dry_choice = ""
	_ran_dry = ""
	_active_snippet = null
	_beat_index = 0
	_clear_pending()
	_started = true

	var bundle: Dictionary = _host.bundle
	if block_id != "":
		if not _host.block_index.has(block_id):
			push_error("unknown block: " + block_id)
			return
		var bsid: String = _host.block_index[block_id]
		_enter_scene_setup(bsid)
		_stack.append({"scene": bsid, "container": block_id, "index": 0})
		_enter(block_id)
	else:
		var sid := scene_id
		if sid == "" and not bundle["scenes"].is_empty():
			sid = bundle["scenes"].keys()[0]
		if not bundle["scenes"].has(sid):
			push_error("unknown scene: " + sid)
			return
		_enter_scene_setup(sid)
		var blocks: Array = bundle["scenes"][sid]["blocks"]
		if not blocks.is_empty():
			_stack.append({"scene": sid, "container": blocks[0]["id"], "index": 0})
			_enter(blocks[0]["id"])
	_settle()


func advance() -> Dictionary:
	_last_error = ""
	if _closed:
		return {"type": "end", "reason": "ended"}  # a stale reference to a closed flow drives nothing
	if not _started:
		_refuse("flow has not been started")
		return {"type": "end", "reason": "ended"}
	_touch()
	if _pending_prompt_beat != null:
		var b = _pending_prompt_beat
		var shown = _pending_prompt_shown
		_pending_prompt_beat = null
		_pending_prompt_shown = null
		_pending_prompt_owner = ""
		return _prompt_result(b, shown) if shown != null else _beat_result(b)
	_settle()
	if _last_error != "":
		return {"type": "end", "reason": "ended"}   # refused part way: last_error() says why
	if not _flow_ended and _active_snippet == null and _pending == null:
		_flow_ended = true
	if _flow_ended:
		return _end_result()
	_dry_choice = ""   # a choice or a beat comes after it: play carried on past the dry choice
	if _pending != null:
		return {"type": "choice", "groupId": _pending["group_id"], "options": _offer()}
	var beat = _active_snippet.get("beats", [])[_beat_index]
	_beat_index += 1
	return _beat_result(beat)


## The end step. The first time a flow reports its end straight after a choice ran dry, that choice is
## why it ended: say so through on_error, once (kind "dry-choice"). An explicit END reached after it still
## counts; a block simply ending, with nothing dry, is just the end. Its "reason" is "ran-dry" or "ended".
func _end_result() -> Dictionary:
	if _dry_choice != "":
		var group := _dry_choice
		_dry_choice = ""
		_ran_dry = group
		_report({"flow": id, "kind": "dry-choice", "node": group,
			"message": "choice '%s' ran dry (no option left to take, and no fallback) with nothing after it, so the flow ended there" % group})
	return {"type": "end", "reason": "ran-dry" if _ran_dry != "" else "ended"}


## Pick an eligible option by id; the next advance() runs it. A refusal (no choice pending, an unknown
## option, a greyed one) is push_error'd and kept for last_error(), and changes nothing.
func choose(option_id: String) -> void:
	_last_error = ""
	if _pending == null:
		_refuse("no choice is pending")
		return
	if not _pending["by_id"].has(option_id):
		_refuse("unknown choice option: " + option_id)
		return
	# A greyed option is offered so the player can see it, never so it can be taken. The other three
	# runtimes refuse it; this one used to play its content and spend it.
	for o in _pending["options"]:
		if o["id"] == option_id and not o["eligible"]:
			_refuse("choice option is not eligible: " + option_id)
			return
	_touch()
	var node = _pending["by_id"][option_id]
	# Speak the chosen option's prompt back as its first beat (spec 5): only an AUTHORED prompt, and exactly
	# as the choice showed it (the one prompt that doesn't follow the language: a documented exception). A
	# prompt borrowed from the option's own first content line is not replayed, since that line is about to
	# play as content anyway. A choice never delivered since a load shows its prompt as it would be now,
	# before the option's onEnter runs.
	var authored = _authored_prompt_of(node) if _host.replay_prompt_on_choose else null
	var shown = null
	if authored != null:
		var was: Dictionary = _pending["shown"]
		shown = was[option_id] if was.has(option_id) else _prompt_for(node)
		if shown != null:
			shown = (shown as Dictionary).duplicate()
	if _host.tracing:
		_emit({"type": "chose", "group": _pending["group_id"], "option": option_id})
	_pending = null
	_pending_prompt_beat = authored if authored != null and shown != null else null
	_pending_prompt_shown = shown if _pending_prompt_beat != null else null
	_pending_prompt_owner = node["id"] if _pending_prompt_beat != null else ""
	_enter_child(node)


func get_property(ref: String):
	var sp := split_host_ref(_host, ref)
	if sp[0] == "patter":
		return _patter_get(sp[1])
	if sp[0] == "scene":
		return _scene_get(sp[1])
	return _host.registry.get_value(sp[0], sp[1])   # host scopes, other engines' scopes


## Write a property by ref. The GAME's surface, so it writes with HOST authority: a host
## declaration's "writable": false binds the story, not the game that owns the value. The story's
## own writes (effects) go through _write_property(.., false).
##
## Returns "" when the value was written, else why it was refused (also push_error'd), with nothing
## changed: a value that doesn't fit the property's declaration, a name the content doesn't declare
## (an @scene name in the scene this flow is in), an @scene write before the flow has entered a scene,
## or a write the registry turns down. As PatterEngine.set_property.
func set_property(ref: String, value) -> String:
	return _write_property(ref, value, true)


## A quality's ladder, for game code holding one of its values: the position of `value` on the ladder
## of the quality `ref` names (@patter, @scene in the scene this flow is in, or a host scope), or -1
## when it isn't one of the stages. A ref that isn't a quality is push_error'd, and gives -1.
func stage_index(ref: String, value) -> int:
	var ladder = _ladder_of(ref)
	return -1 if ladder == null else PatterExpr.stage_index(ladder, value)


## -1, 0 or 1 as stage `a` is below, at or above stage `b` on that ladder; an EvalError when either
## isn't a stage, or `ref` isn't a quality.
func compare_stages(ref: String, a, b) -> Variant:
	var ladder = _ladder_of(ref)
	return PatterExpr.error("'%s' is not a quality" % ref) if ladder == null else PatterExpr.compare_stages(ladder, a, b)


## The stage after `value` on that ladder, staying on the top rung, as advance() does; an EvalError
## when `value` isn't a stage, or `ref` isn't a quality.
func next_stage(ref: String, value) -> Variant:
	var ladder = _ladder_of(ref)
	return PatterExpr.error("'%s' is not a quality" % ref) if ladder == null else PatterExpr.next_stage(ladder, value)


func _ladder_of(ref: String):
	var sp := split_host_ref(_host, ref)
	_context()   # the registry's quality lookup, for a scope another engine or the game declares
	var ladder = _stages_for(sp[0], sp[1])
	if ladder == null:
		push_error("'%s' is not a quality" % ref)
	return ladder


## The write itself. `host` says WHO is writing, which is all "writable": false cares about. Returns
## "" when the write landed, else why it was refused (nothing written): an effect that gets a refusal
## is a failed effect (see _run_effects).
func _write_property(ref: String, value, host: bool) -> String:
	var sp := split_host_ref(_host, ref)
	# The game's value must fit what the content declared; the story's own writes were checked as they
	# compiled.
	if host and not (sp[0] == "scene" and _current_scene_id == ""):
		var unfit := host_write_refusal(_host, sp[0], sp[1], value, _current_scene_id)
		if unfit != "":
			push_error(unfit)
			return unfit
	var journal = _host.journal
	if sp[0] == "patter":
		# Inside a checkpoint, each write records how to put the old value back, against the bag it
		# actually landed in (a `@scene` write's bag depends on the scene the flow is in at the time).
		if journal != null:
			var shared: bool = _host.patter_shared_names.has(sp[1])
			var prev = _host.patter_bag.get_value(sp[1]) if shared else _local.get_value(sp[1])
			if prev != null:
				if shared:
					journal["undo"].append(Callable(_host.registry, "set_value").bind("patter", sp[1], prev))
				else:
					journal["undo"].append(PatterFlow._undo_bag_set.bind(_local, sp[1], prev))
		return _patter_set(sp[1], value)
	elif sp[0] == "scene":
		if _current_scene_id == "":
			# A host write with nowhere to land errors, never silently vanishes; a story write reports it
			# as a failed effect instead.
			var msg := "'%s': the flow has not entered a scene yet" % ref
			if host:
				push_error(msg)
			return msg
		if journal != null:
			var bag = _scene_bag_for(sp[1])
			var prev = bag.get_value(sp[1]) if bag != null else null
			if prev != null:
				journal["undo"].append(PatterFlow._undo_bag_set.bind(bag, sp[1], prev))
		return _scene_set(sp[1], value)
	else:
		# Host scopes and other engines' scopes. "writable": false is the STORY's promise, so the
		# registry refuses a story write (push_error, no write) and lets the game's own through.
		var prev = _host.registry.get_value(sp[0], sp[1]) if journal != null else null
		var refused: String = _host.registry.set_value(sp[0], sp[1], value, {"host": true} if host else {})
		# Recorded after the write: one a read-only host scope refused never happened, so has nothing to undo.
		if journal != null and refused == "" and prev != null:
			journal["undo"].append(Callable(_host.registry, "set_value").bind(sp[0], sp[1], prev, {"host": true}))
		return refused


## Undo helpers for a checkpoint's journal. Static, with what they act on bound in, so an undo never
## depends on the flow that recorded it still being alive.
static func _undo_bag_set(bag, name: String, prev) -> void:
	bag.set_value(name, prev)


## The undo of an entry: this flow's own visit count and the world's, each put back.
static func _put_back_visits(own: Dictionary, shared: Dictionary, key, own_was, was) -> void:
	_put_back(own, key, own_was)
	_put_back(shared, key, was)


## Put `key` in `map` back to `was`, or remove it when it was absent (null).
static func _put_back(map: Dictionary, key, was) -> void:
	if was == null:
		map.erase(key)
	else:
		map[key] = was


# -- scope resolvers -----------------------------------------------------------

func _patter_get(n: String):
	if _host.patter_shared_names.has(n):
		return _host.patter_bag.get_value(n)
	return _local.get_value(n)


## Returns "" or the refusal, as _write_property does.
func _patter_set(n: String, v) -> String:
	if _host.patter_shared_names.has(n):
		return _host.registry.set_value("patter", n, v)
	var change: Dictionary = _local.set_value(n, v)
	return str(change["error"]) if change.has("error") else ""


## The bag a `@scene` property of the current scene lives in (the scene's stage bag, or this flow's),
## made and registered if missing.
func _scene_bag_for(n: String):
	var s := _current_scene_id
	if s == "" or not _host.bundle["scenes"].has(s):
		return null
	_ensure_scene_bags(s)
	var shared: bool = _host.scene_shared_names.get(s, {}).has(n.to_lower())
	if shared:
		return _host.stage_bags.get(s)
	return _scene_bags.get(s)


func _scene_get(n: String):
	var bag = _scene_bag_for(n)
	# get_value, NOT get: these are PatterPropertyBag objects now, and Object.get(n) is a
	# lookup of the MEMBER named n, which would quietly answer null for every property.
	return bag.get_value(n) if bag != null else null


## Returns "" or the refusal, as _write_property does.
func _scene_set(n: String, v) -> String:
	var bag = _scene_bag_for(n)
	if bag != null:
		# Not silent: an engine write notifies subscribers and is audited, where a host
		# write is silent but still audited. This is the engine's own write.
		var change: Dictionary = bag.set_value(n, v)
		if change.has("error"):
			return str(change["error"])
	return ""


# -- settle / entry ------------------------------------------------------------

func _settle() -> void:
	var transitions := 0
	while true:
		transitions += 1
		if transitions > 10000:
			_refuse("flow did not settle after 10000 transitions - likely a jump cycle with no deliverable content")
			return
		if _flow_ended or _pending != null:
			return

		if _active_snippet != null:
			if _beat_index < _active_snippet.get("beats", []).size():
				return
			_run_effects(_active_snippet.get("onExit", []), _active_snippet["id"])
			var jump = _active_snippet.get("jump")
			_active_snippet = null
			_beat_index = 0
			_resolve_jump(jump)
			continue

		if _stack.is_empty():
			_flow_ended = true
			return
		var frame = _stack[_stack.size() - 1]
		if frame["scene"] != _current_scene_id:
			_current_scene_id = frame["scene"]
		var children = _children_of(frame["container"])
		if children == null:
			_stack.pop_back()
			continue
		# A `run` container walks its children in order, skipping the ones whose condition
		# does not hold. That skip IS the decision an author asks about, so the trace
		# records the ones walked past, not only the one entered.
		var _from: int = frame["index"]
		while frame["index"] < children.size() and not _eligible(children[frame["index"]]):
			frame["index"] += 1
		if _host.tracing and frame["index"] != _from:
			var seen: Array = []
			for i in range(_from, mini(frame["index"] + 1, children.size())):
				seen.append({"id": children[i]["id"], "eligible": i == frame["index"]})
			var picked_id = children[frame["index"]]["id"] if frame["index"] < children.size() else null
			_emit({"type": "select", "group": frame["container"], "selector": "run",
				"children": seen, "picked": picked_id})
		if frame["index"] >= children.size():
			_stack.pop_back()
			continue
		var child = children[frame["index"]]
		frame["index"] += 1
		_enter_child(child)


func _enter_scene_setup(scene_id: String) -> void:
	var bundle: Dictionary = _host.bundle
	if not bundle["scenes"].has(scene_id):
		push_error("unknown scene: " + scene_id)
		return
	var scene: Dictionary = bundle["scenes"][scene_id]
	_current_scene_id = scene_id
	_enter(scene_id)
	_seed_scene(scene)
	_run_effects(scene.get("onEntry", []), scene_id)


func _enter_child(node: Dictionary) -> void:
	_enter(node["id"])
	if node.get("type", "") == "snippet":
		_begin_snippet(node)
		return
	var selector: String = node.get("selector", "run")
	if selector == "run":
		_stack.append({"scene": _current_scene_id, "container": node["id"], "index": 0})
		return
	if selector == "choice":
		_setup_choice(node)
		return
	var pick = _select_child(node)
	if pick != null:
		_enter_child(pick)


func _children_of(container_id: String):
	if _host.block_by_id.has(container_id):
		return _host.block_by_id[container_id]["children"]
	if _host.node_index.has(container_id):
		var node: Dictionary = _host.node_index[container_id]
		if node.get("type", "") == "group":
			return node.get("children", [])
	return null


func _begin_snippet(snippet: Dictionary) -> void:
	_run_effects(snippet.get("onEnter", []), snippet["id"])
	_active_snippet = snippet
	_beat_index = 0


func _setup_choice(group: Dictionary) -> void:
	var options: Array = []
	var by_id: Dictionary = {}
	var fallbacks: Array = []
	for child in group.get("children", []):
		if child.get("fallback", false):
			fallbacks.append(child)
			continue
		if not child.get("sticky", false) and _visit_counts.get(child["id"], 0) >= 1:
			continue
		var elig := _eligible(child)
		if not elig and child.get("secretUntilEligible", false):
			continue
		# Which option, and whether it can be taken: its prompt is built when the choice is delivered.
		var opt := {"id": child["id"], "eligible": elig}
		if child.get("gameData") is Dictionary:
			opt["gameData"] = child["gameData"]
		options.append(opt)
		by_id[child["id"]] = child
	# A choice is offered only when the player can take something. One whose every remaining option is
	# greyed out left the player stuck in front of it, so it runs dry instead, as a choice with no
	# options does: the fallback follows if there is one, otherwise the flow moves on.
	if options.any(func(o): return o["eligible"]):
		# Including the ones a condition left ineligible: "why is that greyed out" is a
		# question about the moment the choice was built.
		if _host.tracing:
			var offered: Array = []
			for o in options:
				offered.append({"id": o["id"], "eligible": o["eligible"]})
			_emit({"type": "choice", "group": group["id"], "options": offered})
		_pending = {"group_id": group["id"], "options": options, "by_id": by_id, "shown": {}}
		return
	for f in fallbacks:
		if _eligible(f):
			_enter_child(f)
			return
	# Nothing takeable and no eligible fallback: the choice runs dry and the flow walks past
	# it. The behaviour is unchanged; this makes the silent fall-through observable.
	if _host.tracing:
		_emit({"type": "dry", "group": group["id"]})
	# Beside the log, not instead of it: the callback is live feedback a host acts on, the
	# log is an audit read afterwards, and a shipped game runs with the log off and this
	# still wired. Parity with the JS runtime's onDryChoice, which the ports never had.
	var on_dry = _host.on_dry_choice
	if on_dry is Callable and (on_dry as Callable).is_valid():
		(on_dry as Callable).call(group["id"])
	_dry_choice = str(group["id"])   # if the flow ends before anything else plays, this is why


# -- jumps ---------------------------------------------------------------------

func _resolve_jump(jump) -> void:
	if jump == null:
		return
	_enter_target(jump["to"], "call" if jump.get("mode", "") == "call" else "jump")


func _enter_target(to: String, mode: String) -> void:
	if _host.tracing:
		_emit({"type": "jump", "to": to, "mode": mode})
	if to == "END":
		_flow_ended = true
		_stack = []
		return
	var bundle: Dictionary = _host.bundle
	var scene_id := ""
	var container_id := ""
	if bundle["scenes"].has(to):
		_enter_scene_setup(to)
		var blocks: Array = bundle["scenes"][to]["blocks"]
		if blocks.is_empty():
			if mode == "jump":
				_stack = []
			return
		scene_id = to
		container_id = blocks[0]["id"]
	else:
		if not _host.block_index.has(to):
			_refuse("jump target not found: " + to)
			return
		var sid: String = _host.block_index[to]
		if sid != _current_scene_id:
			_enter_scene_setup(sid)
		scene_id = sid
		container_id = to
	_enter(container_id)
	var frame := {"scene": scene_id, "container": container_id, "index": 0}
	if mode == "call":
		_stack.append(frame)
	else:
		_stack = [frame]


# -- selectors -----------------------------------------------------------------

func _select_child(group: Dictionary):
	var eligible: Array = []
	var verdicts: Array = []
	for c in group.get("children", []):
		var ok := _eligible(c)
		verdicts.append({"id": c["id"], "eligible": ok})
		if ok:
			eligible.append(c)
	var sel: String = group.get("selector", "")
	var o: Dictionary = group.get("options", {})
	# The reasoning goes in the entry: every child looked at, with its verdict.
	var trace := func(picked):
		if not _host.tracing:
			return picked
		var ev := {"type": "select", "group": group["id"],
			"selector": sel if sel != "" else "default", "children": verdicts,
			"picked": picked["id"] if picked != null else null}
		if sel == "sequence":
			ev["order"] = o.get("order", "sequential")
			ev["exhaust"] = o.get("exhaust", "once")
		_emit(ev)
		return picked
	if eligible.is_empty():
		return trace.call(null)
	var st := _selector_state_for(group)
	if sel == "branch":
		return trace.call(eligible[0])
	if sel == "sequence":
		var order: String = o.get("order", "sequential")
		var exhaust: String = o.get("exhaust", "once")
		if order == "shuffle":
			return trace.call(_pick_shuffle(eligible, exhaust, st))
		if order == "specificity":
			return trace.call(_pick_specificity(eligible, exhaust, st))
		return trace.call(_pick_sequential(eligible, exhaust, st))
	return null   # run / choice / default are handled in _enter_child, not here


func _pick_sequential(eligible: Array, exhaust: String, st: Dictionary):
	var n: int = st.get("seq", 0)
	st["seq"] = n + 1
	var ln := eligible.size()
	if exhaust == "repeat":
		return eligible[n % ln]
	if n < ln:
		return eligible[n]
	if exhaust == "stick":
		return eligible[ln - 1]
	return null


func _pick_shuffle(eligible: Array, exhaust: String, st: Dictionary):
	var ln := eligible.size()
	var stick := exhaust == "stick"
	var eligible_ids := {}
	for c in eligible:
		eligible_ids[c["id"]] = true
	if not st.has("bag_init"):
		st["bag"] = _fill_ids(eligible, stick, ln)
		st["bag_init"] = true
	# The bag was filled from the children eligible THEN. Draw only from those still eligible now, so a
	# child whose condition has since gone false is never drawn (it used to be drawn, and the group then
	# played nothing). If none of the bag is drawable, the pass is over, exactly as when the bag is empty.
	if not (st["bag"] as Array).any(func(bid): return eligible_ids.has(bid)):
		if exhaust == "once":
			return null
		if stick:
			var last_node = eligible[ln - 1]
			st["last"] = last_node["id"]
			return last_node
		st["bag"] = _fill_ids(eligible, stick, ln)   # repeat: reshuffle
		if (st["bag"] as Array).is_empty():
			return null
	# Draw without replacement, never repeating the immediately-previous pick when another is drawable.
	# With every bag member still eligible the pool is the bag itself, in its order, so a seeded draw
	# lands exactly where it always did.
	var bag: Array = st["bag"] as Array
	var pool: Array = bag.filter(func(bid): return eligible_ids.has(bid))
	var p := (pool.find(st["last"]) if (st.has("last") and pool.size() > 1) else -1)
	var span := (pool.size() - 1 if p >= 0 else pool.size())
	var i := int(floor(_rng() * span))
	if p >= 0 and i >= p:
		i += 1
	var pick = pool[i]
	bag.remove_at(bag.find(pick)) # draw without replacement, in place
	st["last"] = pick
	for c in eligible:
		if c["id"] == pick:
			return c
	return null


# order == "specificity" (Best match): keep the top matched-specificity tier, tie-break by the seeded
# PRNG (no immediate repeat); a no-condition child scores 0 (the filler). Composes with exhaust like
# shuffle: repeat re-scores every draw; once/stick draw without replacement (a bag of remaining ids).
func _pick_specificity(eligible: Array, exhaust: String, st: Dictionary):
	var repeat := exhaust == "repeat"
	var pool: Array = []
	if repeat:
		pool = eligible
	else:
		if not st.has("bag_init"):
			var ids: Array = []
			for c in eligible:
				ids.append(c["id"])
			st["bag"] = ids
			st["bag_init"] = true
		var bag: Array = st["bag"] as Array
		for c in eligible:
			if bag.has(c["id"]):
				pool.append(c)
		if pool.is_empty():
			if exhaust == "stick" and st.has("last"):
				for c in eligible:
					if c["id"] == st["last"]:
						return c
			return null
	# Top specificity tier among the drawable pool.
	var best := -1
	var scores: Array = []
	for c in pool:
		var s := _spec_score(c)
		scores.append(s)
		if s > best:
			best = s
	var tier: Array = []
	for k in pool.size():
		if scores[k] == best:
			tier.append(pool[k])
	# A lone top-tier child is returned WITHOUT drawing, so a clear winner consumes no randomness.
	var pick
	if tier.size() == 1:
		pick = tier[0]
	else:
		var p := -1
		if st.has("last"):
			for k in tier.size():
				if tier[k]["id"] == st["last"]:
					p = k
					break
		var span := (tier.size() - 1 if p >= 0 else tier.size())
		var i := int(floor(_rng() * span))
		if p >= 0 and i >= p:
			i += 1
		pick = tier[i]
	if not repeat:
		(st["bag"] as Array).erase(pick["id"])
	st["last"] = pick["id"]
	return pick


# A child's Best-match score: 0 with no condition (the filler tier), else its (passing) condition's specificity.
func _spec_score(node: Dictionary) -> int:
	if not node.has("condition"):
		return 0
	var ctx := _context()
	var truthy := func(n: Array) -> bool: return PatterValues.truthy(_spec_atom(n, ctx, node))
	return PatterSpecificity.matched_specificity(node["condition"]["ast"], truthy)


# One atom's value for specificity scoring. The scorer walks every part, including an `or` branch
# eligibility never evaluated, so a part can fail here that did not fail there: it scores as false,
# the same reading the JS scorer gives a throwing atom, and is reported (see _report_error).
func _spec_atom(atom: Array, ctx: Dictionary, owner: Dictionary) -> Variant:
	var v = PatterExpr.evaluate(atom, ctx, _dialect)
	if PatterExpr.is_error(v):
		_report_error("best-match", owner["id"], owner["condition"], v.message)
		return false
	return v


func _fill_ids(eligible: Array, stick: bool, ln: int) -> Array:
	var ids: Array = []
	var upto := (ln - 1) if stick else ln
	for i in upto:
		ids.append(eligible[i]["id"])
	return ids


func _selector_state_for(group: Dictionary) -> Dictionary:
	var shared: bool = group.get("shared", false)
	var map: Dictionary = _host.shared_selectors if shared else _selectors
	# A cursor is copied the first time a checkpoint sees it (shared ones once for every flow).
	var journal = _host.journal
	var seen = null
	if journal != null:
		if shared:
			seen = journal["selectors"]
		else:
			if not journal["flow_selectors"].has(self):
				journal["flow_selectors"][self] = {}
			seen = journal["flow_selectors"][self]
	if seen != null and not seen.has(group["id"]):
		seen[group["id"]] = true
		var was = (map[group["id"]] as Dictionary).duplicate(true) if map.has(group["id"]) else null
		journal["undo"].append(PatterFlow._put_back.bind(map, group["id"], was))
	if not map.has(group["id"]):
		map[group["id"]] = {}
	return map[group["id"]]


# -- effects / expressions -----------------------------------------------------

## Run an effect list. `owner` is the snippet or scene it belongs to, for an error report. An effect
## that fails (its value does not evaluate, or the write is refused) is skipped and reported, with no
## `write` entry, and the rest of the list still runs.
func _run_effects(effects: Array, owner: String) -> void:
	for e in effects:
		var v = _eval_expr(e["value"])
		# An effect whose value does not evaluate writes NOTHING. Before the
		# evaluator could refuse, a bad expression silently stored its fallback
		# (0.0, or false) into the property, which is a corrupted save rather
		# than a caught bug.
		if PatterExpr.is_error(v):
			_report_error("effect", owner, e["value"], v.message)
			continue
		# `prev` read before the write, so a reader can say "0 -> 1" in one pass. Only
		# paid for when the run asked for a log.
		var prev = get_property(e["target"]) if _host.tracing else null
		# The STORY writes: a read-only host property refuses it, and a refused write is a failed effect.
		var refused := _write_property(e["target"], v, false)
		if refused != "":
			_report_error("effect", owner, e["value"], refused)
			continue
		if _host.tracing:
			var ev := {"type": "write", "target": e["target"], "value": v}
			if prev != null:
				ev["prev"] = prev
			_emit(ev)


## Whether a node's condition holds. A condition that fails to evaluate counts as false, and is reported.
func _eligible(node: Dictionary) -> bool:
	if not node.has("condition"):
		return true
	var v = _eval_expr(node["condition"])
	# An eval error is never a silent pass: the node is ineligible and the
	# diagnostic surfaces. truthy() would answer false for an EvalError anyway;
	# this says it on purpose, and reports why.
	if PatterExpr.is_error(v):
		_report_error("condition", node["id"], node["condition"], v.message)
		return false
	return PatterValues.truthy(v)


## Report a content error the engine is playing through: to the game's "on_error" Callable (or
## push_warning when none is set, so it is never silent), and to the log as a `diagnostic` entry.
## `node` is the snippet, group, or option whose condition failed, or the snippet or scene owning the
## effect; `expr` the compiled expression, whose `src` rides along when the bundle carries it.
func _report_error(kind: String, node: String, expr, message: String) -> void:
	var err := {"flow": id, "kind": kind, "node": node, "message": message}
	if expr is Dictionary and expr.get("src") != null and str(expr["src"]) != "":
		err["source"] = str(expr["src"])
	_report(err)


## Report a problem this flow carried on past: to the game's "on_error" (see FlowHost.report), and to the
## log as a `diagnostic` entry.
func _report(err: Dictionary) -> void:
	_host.report(err)
	if not _host.tracing:
		return
	var ev := {"type": "diagnostic", "kind": err["kind"], "node": err["node"], "message": err["message"]}
	if err.has("source"):
		ev["source"] = err["source"]
	_emit(ev)


func _eval_expr(expr: Dictionary):
	return PatterExpr.evaluate(expr["ast"], _context(), _dialect)


func _enter(nid: String) -> void:
	var own: Dictionary = _visit_counts
	var own_before = own.get(nid)
	own[nid] = (own_before if own_before != null else 0) + 1
	var shared: Dictionary = _host.shared_visits
	var before = shared.get(nid)
	shared[nid] = (before if before != null else 0) + 1
	if _host.journal != null:
		_host.journal["undo"].append(PatterFlow._put_back_visits.bind(own, shared, nid, own_before, before))


func _rng() -> float:
	var custom = _host.custom_rng
	if custom != null:
		return custom.call()
	return _prng.next()  # the same mixing as PatterMulberry32.next(), no longer duplicated inline


# -- strings / beats -----------------------------------------------------------

func _beat_result(beat: Dictionary) -> Dictionary:
	var kind: String = beat["kind"]
	# Accumulated author tags (#215): omitted from the step when empty (parity with gameData).
	var tags: Array = (_host.tag_index.get(beat["id"], []) as Array).duplicate()
	if kind == "gameEvent":
		var ra := {"type": "gameEvent", "id": beat["id"]}
		if beat.has("gameData"):
			ra["gameData"] = _norm_gamedata(beat["gameData"])
		_put_extensions(ra, beat)
		if not tags.is_empty():
			ra["tags"] = tags
		return ra
	if kind == "text":
		var rt := {"type": "text", "id": beat["id"], "text": _interp(_resolve_string(beat["id"])), "padAfter": _pad_of(beat["id"])}
		# Action text: "action": true (absent when not) marks a direction for whoever stages the scene, never
		# shown to the player (a dialogue scene's text, unless the project localises it). Its text is the source
		# in every locale; the compiler sees to that. A replayed prompt (_prompt_result) never is.
		if beat.get("action", false) == true:
			rt["action"] = true
		_put_spoken(rt, beat)
		if beat.has("gameData"):
			rt["gameData"] = _norm_gamedata(beat["gameData"])
		_put_extensions(rt, beat)
		if not tags.is_empty():
			rt["tags"] = tags
		return rt
	# line
	var raw := _resolve_string(beat["id"])
	var r := {"type": "line", "id": beat["id"]}
	# Closed captions (#214): a line goes SILENT (off only) when the caption CHARACTER speaks it (whole line
	# is a caption, delimiters or not) OR stripping cues leaves it empty. A silent line still fires (audio
	# plays) but carries no text + no speaker.
	var cc_off: bool = not _host.captions_on
	var caption_char: bool = cc_off and beat.get("character", "") == _host.caption_character
	var presented := "" if caption_char else _caption_line(raw if _host.bundle.get("voiced", false) else _interp(raw))
	r["text"] = presented
	var silent: bool = cc_off and presented == ""
	if not silent:
		if beat.has("character"):
			r["character"] = beat["character"]
		var cn = _resolve_character_name(beat)
		if cn != null:
			r["characterName"] = cn
		if beat.has("direction"):
			r["direction"] = beat["direction"]
		if beat.has("qualifier"):
			r["qualifier"] = beat["qualifier"]
		var qn = _resolve_qualifier_name(beat)
		if qn != null:
			r["qualifierName"] = qn
		var label = _speaker_label_of(_host, beat.get("character"), beat.get("qualifier"))
		if label != null:
			r["speakerLabel"] = label
	r["padAfter"] = _pad_of(beat["id"])  # a silent line still fires, so it still carries its pause
	_put_spoken(r, beat)
	if beat.has("gameData"):
		r["gameData"] = _norm_gamedata(beat["gameData"])
	_put_extensions(r, beat)
	if not tags.is_empty():
		r["tags"] = tags
	return r


# How a line or text beat is spoken, onto its step, for timing a line with no recording and for moving a mouth
# (PatterBundle.estimate_line_duration(step["spokenText"], step["spokenLocale"], step["estimateRate"])):
# "spokenText", its text in the project's main language whatever language is shown, interpolated as the shown
# text is (a voiced project's lines aren't), caption cues always left out, and empty for the caption character's
# lines; "spokenLocale", that language; and "estimateRate", the project's syllables a second for an estimate
# ("estimateSyllablesPerSecond", default 4), always there. The first two are left off in an IDs-only bundle, which
# has no text (the game passes its own), and for a beat the main language has no string for.
func _put_spoken(out: Dictionary, beat: Dictionary) -> void:
	var rate = _host.bundle.get("estimateSyllablesPerSecond")
	out["estimateRate"] = float(rate) if rate is float or rate is int else PatterBundle.DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND
	var source = null if _host.emit_ids else _host.default_strings.get(beat["id"])
	if source == null:
		return
	var spoken: String
	if beat["kind"] == "text":
		spoken = _interp(str(source))
	elif beat.get("character", "") == _host.caption_character:
		spoken = ""
	else:
		spoken = strip_captions(str(source) if _host.bundle.get("voiced", false) else _interp(str(source)))
	out["spokenText"] = spoken
	out["spokenLocale"] = str(_host.bundle["locales"]["default"])


# A line or text beat's resolved pause (line padding): its own `padAfter`, else the nearest default above
# it, else the project's, else the built-in one; clamped to zero on a snippet's last line.
func _pad_of(beat_id: String) -> float:
	var pad = _host.pad_index.get(beat_id)
	return float(pad["resolved"]) if pad != null else PatterBundle.DEFAULT_PAD_AFTER


# A node's Patter extension values onto a step or an option, by extension id: raw, exactly as the bundle
# carries them (any JSON, never read by the engine), and left off when the node has none. Fill in the
# defaults with PatterBundle.effective_game_data(PatterBundle.extension_decls(bundle, id, kind), ...).
static func _put_extensions(out: Dictionary, node: Dictionary) -> void:
	var ext = node.get("extensions")
	if ext is Dictionary and not (ext as Dictionary).is_empty():
		out["extensions"] = ext


func _norm_gamedata(gd: Dictionary) -> Dictionary:
	var out := {}
	for k in gd.keys():
		out[k] = PatterValues.to_value(gd[k])
	return out


func _interp(raw: String) -> String:
	return PatterInterp.expand(raw, func(ref): return get_property(ref))


# Caption-strip a dialogue line ONLY when captions are off; otherwise pass it through (#214).
func _caption_line(text: String) -> String:
	return text if _host.captions_on else PatterInterp.strip_captions(text, _host.caption_open, _host.caption_close)


# Public: apply the project's caption rule UNCONDITIONALLY (#214). An IDs-only game calls this on a string
# it looked up in its OWN loc system (after interpolate) when its captions are off.
func strip_captions(text: String) -> String:
	return PatterInterp.strip_captions(text, _host.caption_open, _host.caption_close)


# Public: expand {@ref} slots against this flow's CURRENT state. An IDs-only game calls this on a string it
# looked up in its OWN loc system for a beat id the engine emitted, to apply property replacement.
func interpolate(text: String) -> String:
	return _interp(text)


# An option's prompt (spec 5): its prompt beat, resolved and interpolated, as
# {"kind": "line" | "text", "text": ..., and for a line "character" / "characterName" / "direction" /
# "qualifier" / "qualifierName" / "speakerLabel" when set, and always "padAfter", the prompt beat's
# resolved pause, a float}. The same shape every runtime's choice option carries. null when there is no
# prompt beat.
func _prompt_for(node: Dictionary):
	var beat = _prompt_beat_of(node)
	if beat == null:
		return null
	var text := _interp(_resolve_string(beat["id"]))
	var pad := _pad_of(beat["id"])
	if beat["kind"] != "line":
		return {"kind": "text", "text": text, "padAfter": pad}
	# A line-kind prompt is dialogue, so captions apply; a text-kind prompt is left as-is (#214).
	var p := {"kind": "line", "text": _caption_line(text), "padAfter": pad}
	if beat.has("character"):
		p["character"] = beat["character"]
	var cn = _resolve_character_name(beat)
	if cn != null:
		p["characterName"] = cn
	if beat.has("direction"):
		p["direction"] = beat["direction"]
	if beat.has("qualifier"):
		p["qualifier"] = beat["qualifier"]
	var qn = _resolve_qualifier_name(beat)
	if qn != null:
		p["qualifierName"] = qn
	var label = _speaker_label_of(_host, beat.get("character"), beat.get("qualifier"))
	if label != null:
		p["speakerLabel"] = label
	return p


# A saved prompt's pause: the one it carries (an int or a float after a JSON round-trip), as a float, else
# `fallback`, worked out again from the prompt's beat (a save from before prompts carried one).
static func _saved_pad(prompt: Dictionary, fallback: Callable) -> float:
	var v = prompt.get("padAfter")
	return float(v) if PatterBundle._is_pad(v) else float(fallback.call())


# An option's AUTHORED prompt beat: an Option group's own prompt. The only prompt a replay speaks.
func _authored_prompt_of(node: Dictionary):
	if node.get("type", "") == "group" and node.has("prompt"):
		return node["prompt"]
	return null


# A replayed prompt as a step: the beat's id, gameData, extension values, and tags, and the text and speaker fields the
# choice showed.
func _prompt_result(beat: Dictionary, shown: Dictionary) -> Dictionary:
	var tags: Array = (_host.tag_index.get(beat["id"], []) as Array).duplicate()
	var r := {"type": "text" if shown.get("kind", "") == "text" else "line", "id": beat["id"], "text": str(shown.get("text", ""))}
	if r["type"] == "line":
		for k in ["character", "characterName", "direction", "qualifier", "qualifierName", "speakerLabel"]:
			if shown.has(k):
				r[k] = str(shown[k])
	r["padAfter"] = _pad_of(beat["id"])
	_put_spoken(r, beat)
	if beat.has("gameData"):
		r["gameData"] = _norm_gamedata(beat["gameData"])
	_put_extensions(r, beat)
	if not tags.is_empty():
		r["tags"] = tags
	return r


func _prompt_beat_of(node: Dictionary):
	if node.get("type", "") == "group" and node.has("prompt"):
		return node["prompt"]
	var snippet = node if node.get("type", "") == "snippet" else _first_text_snippet_in(node.get("children", []))
	if snippet == null:
		return null
	for b in snippet.get("beats", []):
		if b["kind"] == "line" or b["kind"] == "text":
			return b
	return null


func _first_text_snippet_in(children: Array):
	for n in children:
		if n.get("type", "") == "snippet":
			for b in n.get("beats", []):
				if b["kind"] == "line" or b["kind"] == "text":
					return n
		elif n.get("type", "") == "group":
			var found = _first_text_snippet_in(n.get("children", []))
			if found != null:
				return found
	return null


func _resolve_string(sid: String) -> String:
	if _host.emit_ids:
		return sid  # IDs-only build: the game resolves text from this id itself
	if _host.strings.has(sid):
		return _host.strings[sid]
	if _host.default_strings.has(sid):
		return "<Untranslated: %s> %s" % [sid, _host.default_strings[sid]]
	return sid


# A line beat's resolved speaker name: the first of the active cast string, the default one, and the cast's
# displayName that exists (an empty string included). null when the beat has no character at all; a
# character set to "" is a token like any other.
func _resolve_character_name(beat: Dictionary):
	if not beat.has("character"):
		return null
	if _host.emit_ids:
		return null  # IDs-only: omit the display name; the game maps the `character` token
	return _character_name_of(_host, str(beat["character"]))


# A line beat's speaker qualifier's shown name, resolved as a character's is: the `qualifier:<gameId>`
# string in the active locale, else the default locale, else the authored name. null when the beat has no
# qualifier, and in IDs-only mode (the game maps the `qualifier` gameId itself).
func _resolve_qualifier_name(beat: Dictionary):
	if not beat.has("qualifier"):
		return null
	if _host.emit_ids:
		return null
	return _qualifier_name_of(_host, str(beat["qualifier"]))


# A project-level loc string: the active locale's, else the default locale's (`source`: the default
# locale's only, as the static structure reads it). null when neither has it; an empty string is a value.
static func _loc_string(host: FlowHost, key: String, source := false):
	if not source and host.strings.has(key):
		return host.strings[key]
	return host.default_strings.get(key)


# A character's shown name: its `cast:<name>` string (see _loc_string), else the cast's displayName. null
# when neither exists.
static func _character_name_of(host: FlowHost, character: String, source := false):
	var nm = _loc_string(host, "cast:" + character, source)
	return nm if nm != null else host.cast_display.get(character)


# A qualifier's shown name: its `qualifier:<gameId>` string (see _loc_string), else its authored name. null
# when neither exists.
static func _qualifier_name_of(host: FlowHost, qualifier: String, source := false):
	var qn = _loc_string(host, "qualifier:" + qualifier, source)
	return qn if qn != null else host.qualifier_display.get(qualifier)


# The name to show for a line's speaker, its `speakerLabel`: with a qualifier, the character's own label
# for that pair when the bundle overrides it (its `speaker:<name>:<gameId>` string, else the authored
# label), else the speaker pattern (the `speaker:pattern` string, else the bundle's, else `{name}
# ({qualifier})`) filled with the character's and the qualifier's shown names; with none, the character's
# shown name. Each piece is looked up as _loc_string does (`source`: the default locale only). The token
# stands in for a name the cast doesn't give, and the gameId for a qualifier's. A pair the bundle doesn't
# override ignores any `speaker:` string a locale holds for it. null with no character (or an empty one),
# and in IDs-only mode. The one resolver: steps, prompts, saved prompts, and the static structure.
static func _speaker_label_of(host: FlowHost, character, qualifier, source := false):
	if character == null or str(character) == "" or host.emit_ids:
		return null
	var who := str(character)
	var nm = _character_name_of(host, who, source)
	var shown_name: String = str(nm) if nm != null else who
	if qualifier == null:
		return shown_name
	var gid := str(qualifier)
	var own: Dictionary = host.speaker_labels.get(who, {})
	if own.has(gid):
		var label = _loc_string(host, "speaker:%s:%s" % [who, gid], source)
		return label if label != null else own[gid]
	var qn = _qualifier_name_of(host, gid, source)
	var pattern = _loc_string(host, "speaker:pattern", source)
	return PatterBundle.format_speaker_label(str(pattern) if pattern != null else host.speaker_pattern, shown_name, str(qn) if qn != null else gid)


func _seed_scene(scene: Dictionary) -> void:
	var shared: Dictionary = _host.scene_shared_names.get(scene["id"], {})
	_ensure_scene_bags(scene["id"])
	for decl in scene.get("sceneProps", []):
		if not decl.get("temporary", false):
			continue
		var tnm: String = str(decl["name"]).to_lower()
		var target_bag = _host.stage_bags[scene["id"]] if shared.has(tnm) else _scene_bags[scene["id"]]
		var prev = target_bag.get_value(tnm) if _host.journal != null else null
		if prev != null:
			_host.journal["undo"].append(PatterFlow._undo_bag_set.bind(target_bag, tnm, prev))
		# Through set_value, so the reset is audited: a temporary snapping back to its
		# default is a state change, and a log that omits it is wrong.
		target_bag.set_value(tnm, PatterBundle.prop_default(decl))


# The declarations for one half of a scene's props: the shared ones (stage bag) or the
# rest (per-flow scene bag).
static func _props_for(props: Array, shared: Dictionary, want_shared: bool) -> Array:
	var out := []
	for d in props:
		if shared.has(str(d["name"]).to_lower()) == want_shared:
			out.append(d)
	return out


## Make (and register) scene `s`'s stage bag and this flow's bag for it, if not made yet. A bag made
## here claims whatever values the registry holds for its key: that is how a loaded save reaches it
## (the bag's load rule: a property the save predates keeps its declared default, one the bundle has
## since dropped lands as a stray).
##
## The bag's constructor seeds each declared default (the type's when none), lowercases the name, and
## deep-copies the default so two bags from one declaration set never share a mutable flags array.
func _ensure_scene_bags(s: String) -> void:
	var shared: Dictionary = _host.scene_shared_names.get(s, {})
	var props: Array = _host.bundle["scenes"].get(s, {}).get("sceneProps", [])
	var journal = _host.journal
	var mounted := not _scene_bags.has(s) or not _host.stage_bags.has(s)
	if not _scene_bags.has(s):
		var bag = PatterPropertyBag.new(_props_for(props, shared, false), {"path_prefix": "@scene."})
		var key := key_flow_scene(id, s)
		var before := var_to_str(bag.save()) if journal != null else ""
		if _host.registry.mount_owned(key, bag, {"owner": OWNER}) == "":
			_registered[key] = true
		_scene_bags[s] = bag
		# Made inside a checkpoint: a rollback unmakes it, so the scene seeds afresh on its next real entry,
		# unless the mount claimed values a load had parked, which go back to the registry (see _claimed).
		if journal != null:
			journal["undo"].append(_unmake_scene_bag.bind(s, bag, key, _claimed(bag, before)))
	if not _host.stage_bags.has(s):
		var bag = PatterPropertyBag.new(_props_for(props, shared, true), {"path_prefix": "@scene."})
		var before := var_to_str(bag.save()) if journal != null else ""
		_host.registry.mount_owned(key_stage(s), bag, {"owner": OWNER})
		_host.stage_bags[s] = bag
		if journal != null:
			journal["undo"].append(PatterFlow._unmake_stage_bag.bind(_host, s, bag, _claimed(bag, before)))
	if mounted:
		_host.report_refits()   # a bag that claimed values a refitting load parked says what it put back


## Whether a mount CLAIMED values a load had parked: `before` is the fresh bag's values. Only a rollback
## needs to know, since it must hand claimed values back to the registry, or a scene first entered inside
## a checkpoint loses its saved values. A fresh bag holds only its defaults, so a change across the mount
## is a claim. Parked values equal to the defaults are not told apart, and need not be: dropping them
## changes nothing a story can read.
static func _claimed(bag, before: String) -> bool:
	return var_to_str(bag.save()) != before


## The undo of a flow scene bag made inside a checkpoint.
func _unmake_scene_bag(s: String, bag, key: String, claimed: bool) -> void:
	if not is_same(_scene_bags.get(s), bag):
		return   # already released with the flow
	if _host.registry.has(key):
		_host.registry.remove(key, {"keep": claimed})
	_registered.erase(key)
	_scene_bags.erase(s)


## The undo of a scene's stage bag made inside a checkpoint.
static func _unmake_stage_bag(host: FlowHost, s: String, bag, claimed: bool) -> void:
	if not is_same(host.stage_bags.get(s), bag):
		return   # already gone
	var key := key_stage(s)
	if host.registry.has(key):
		host.registry.remove(key, {"keep": claimed})
	host.stage_bags.erase(s)


func _fresh_local():
	# This flow's NOT-shared @patter half, in a bag for the same reasons as the shared one.
	return PatterPropertyBag.new(_host.patter_local_decls, {"path_prefix": "@patter."})


## Register a fresh globals bag under this flow's key; it claims any values waiting there.
func _mount_local() -> void:
	_local = _fresh_local()
	var key := key_flow_globals(id)
	if _host.registry.mount_owned(key, _local, {"owner": OWNER}) == "":
		_registered[key] = true
	_host.report_refits()


## Engine-driven (close, load_game, hot_swap): remove every bag this flow registered. With `keep`,
## their values wait in the registry for the flow that replaces this one.
func _release_bags(keep: bool) -> void:
	for key in _registered:
		if _host.registry.has(key):
			_host.registry.remove(key, {"keep": keep})
	_registered = {}
	_scene_bags = {}


# -- registry keys ---------------------------------------------------------------
#
# The keys the engine stores its bags under. They are in the save, so every runtime writes the same
# ones: `patter` for the shared globals, `patter/scene/<sceneId>` for a scene's shared `@scene` props,
# `patter/flow/<flowId>/patter` and `patter/flow/<flowId>/scene/<sceneId>` for a flow's own. An id
# is escaped (`%` as `%25`, then `/` as `%2F`) so a flow named `npc/bob` cannot meet another's key.

static func _esc(s: String) -> String:
	return s.replace("%", "%25").replace("/", "%2F")


## The inverse of _esc.
static func _unesc(s: String) -> String:
	return s.replace("%2F", "/").replace("%25", "%")


## A scene's SHARED `@scene` props (one bag per scene, every flow's).
static func key_stage(scene_id: String) -> String:
	return "patter/scene/" + _esc(scene_id)


## Everything one flow registers starts with this.
static func key_flow(flow_id: String) -> String:
	return "patter/flow/%s/" % _esc(flow_id)


## A flow's NOT-shared `@patter` globals.
static func key_flow_globals(flow_id: String) -> String:
	return key_flow(flow_id) + "patter"


## A flow's NOT-shared `@scene` props for one scene.
static func key_flow_scene(flow_id: String, scene_id: String) -> String:
	return key_flow(flow_id) + "scene/" + _esc(scene_id)


## The ONE rule for resolving a scene address, used by open_flow, goto, and every engine lookup: its
## gameId (the host-facing address, spec 6) first, then its internal id. "" when neither resolves.
## open_flow used to try the internal id first and goto the gameId, so the two could land in different
## scenes when one scene's id was another's gameId.
static func resolve_scene(host: FlowHost, ref: String) -> String:
	var by_game_id: Dictionary = host.scene_game_id_to_id
	if by_game_id.has(ref):
		return by_game_id[ref]
	return ref if (host.bundle["scenes"] as Dictionary).has(ref) else ""


## The one rule for a block address, always WITHIN a scene: its gameId there first, then the internal id
## of a block in that scene. A real block of another scene does not resolve. "" when it does not.
static func resolve_block(host: FlowHost, scene_id: String, ref: String) -> String:
	var addrs: Dictionary = host.block_game_id_to_id.get(scene_id, {})
	if addrs.has(ref):
		return addrs[ref]
	return ref if host.block_index.get(ref, "") == scene_id else ""


## Split a ref into [scope, name] against the registry's current tokens (`@scene` is always the
## flow's). Memoised per ref on the engine's host; the memo is dropped when the registry's set of
## scopes moves.
##
## Another engine's scope the content names (the bundle's externalScopes, `@story.act`) is a scope
## even while nothing registers it (a flow cannot open without it, but that engine can take it away
## mid-game): a write then fails naming it, where it would otherwise land in @patter as a property
## called `story.act`.
static func split_host_ref(host: FlowHost, ref: String) -> Array:
	var reg = host.registry
	if host.ref_split_revision != reg.revision:
		host.ref_split_cache = {}
		host.ref_split_revision = reg.revision
	var cache: Dictionary = host.ref_split_cache
	if not cache.has(ref):
		var external: Array = host.external_scopes
		cache[ref] = PatterBundle.split_ref_with(ref, func(t: String) -> bool:
			return t == "scene" or reg.has(t) or external.has(t))
	return cache[ref]


## Why a host write is refused, or "" when it isn't (the hands-on review, 2026-10): a value that doesn't
## fit what the content declared (a string for a number, a value an enum or a quality doesn't list, a flag
## a flags property doesn't), or a name the content doesn't declare. The rule is the kernel's value_fits,
## the one a load walks saved values with, so a value the game may set is exactly one a save may carry;
## an enum whose own default is "" (none chosen) takes "" back. A scope the bundle doesn't declare
## (another engine's, or one the game keeps) is its owner's to check, and one that declares no names (an
## opaque scope) takes any name and value. `name` is lowercased, as split_host_ref gives it; `scene_id`
## is the scene an @scene write lands in. The same rule and message on every runtime, and in the Storylet
## Engine's. JS's checkHostWrite.
static func host_write_refusal(host: FlowHost, scope: String, name: String, value, scene_id: String) -> String:
	var decls = null
	if scope == "patter":
		decls = host.bundle.get("properties", [])
	elif scope == "scene":
		decls = (host.bundle["scenes"] as Dictionary).get(scene_id, {}).get("sceneProps", [])
	else:
		var spec := {}
		for s in host.bundle.get("scopeRegistry", {}).get("scopes", []):
			if str(s.get("token", "")) == scope:
				spec = s
				break
		# An opaque scope declares no names: any name and value is the game's.
		if spec.is_empty() or spec.get("declarations") == null:
			return ""
		decls = spec["declarations"]
	var decl = null
	for d in (decls if decls is Array else []):
		if str(d.get("name", "")).to_lower() == name:
			decl = d
			break
	var path := "@%s.%s" % [scope, name]
	if decl == null:
		return 'no property at "%s": the content declares no %s' % [path, path]
	var none_chosen: bool = str(decl.get("type", "")) == "enum" and decl.get("default") is String and str(decl["default"]) == ""
	if not PatterPropertyBag.value_fits(decl, value, none_chosen):
		return '"%s" takes %s; %s doesn\'t fit' % [path, _takes(decl), _js_json(value)]
	return ""


## What a declared property takes, in words, for a refused host write.
static func _takes(decl: Dictionary) -> String:
	var quoted := func(xs) -> String:
		var out: Array[String] = []
		for x in (xs if xs is Array else []):
			out.append(JSON.stringify(str(x)))
		return ", ".join(out)
	match str(decl.get("type", "")):
		"number":
			return "a number"
		"boolean":
			return "true or false"
		"enum":
			return "one of %s" % quoted.call(decl.get("values"))
		"flags":
			var values = decl.get("values")
			if values is Array and not (values as Array).is_empty():
				return "a list of flags from %s" % quoted.call(values)
			return "a list of flags"
		"quality":
			return "one of its stages %s" % quoted.call(decl.get("stages"))
	return "text"


## A value as JavaScript's JSON.stringify writes it, for a refusal that quotes what the game handed over:
## a whole number with no ".0", a string quoted, a list with no spaces.
static func _js_json(value) -> String:
	if value == null:
		return "null"
	if value is bool:
		return "true" if value else "false"
	if value is int or value is float:
		var n := float(value)
		return "null" if is_nan(n) or is_inf(n) else PatterValues.js_number(n)
	if value is Array or value is PackedStringArray:
		var items: Array[String] = []
		for item in value:
			items.append(_js_json(item))
		return "[" + ",".join(items) + "]"
	if value is Dictionary:
		var fields: Array[String] = []
		for key in value:
			fields.append(JSON.stringify(str(key)) + ":" + _js_json(value[key]))
		return "{" + ",".join(fields) + "}"
	return JSON.stringify(str(value))


## One flow's own values (a PatterEngine.capture_flow state's) as registry sections under flow
## `flow_id`'s keys.
static func flow_sections(flow_id: String, f: Dictionary) -> Dictionary:
	var out := {}
	if f.get("scopes") is Dictionary and f["scopes"].get("patter") is Dictionary:
		out[key_flow_globals(flow_id)] = f["scopes"]["patter"]
	var bags = f.get("sceneBags")
	if bags is Dictionary:
		for sid in bags:
			out[key_flow_scene(flow_id, str(sid))] = bags[sid]
	return out


## The inverse of flow_sections: flow `flow_id`'s sections in a registry save, without the id, as
## {"scopes": {"patter": values}, "sceneBags": {sceneId: values}}. Values still waiting in the
## registry for a scene the flow hasn't re-entered are in the save, so they come too.
static func flow_values_from(flow_id: String, saved: Dictionary) -> Dictionary:
	var scopes := {}
	var scene_bags := {}
	var prefix := key_flow(flow_id)
	for key in saved:
		var k := str(key)
		if not k.begins_with(prefix):
			continue
		var rest := k.substr(prefix.length())
		if rest == "patter":
			scopes["patter"] = saved[key]
		elif rest.begins_with("scene/"):
			scene_bags[_unesc(rest.substr("scene/".length()))] = saved[key]
	return {"scopes": scopes, "sceneBags": scene_bags}


# -- save / restore ------------------------------------------------------------
#
# A save is written in the FAMILY's shape: `patter/save@0`, the JS reference's, documented in
# @patterkit/model and design/patter-schema.md 9. camelCase literal keys, the execution position
# under `cursor`, a pending choice as `{groupId, options}`, selector cursors with every key optional.
# Every Patterplay runtime writes and reads exactly this, so a save crosses engines. A save holds no
# property values: those are the registry's, carried under `registry` only when the engine made its
# own. Version 4 (1.0) keeps a pending choice's options as `{id, eligible, gameData?}` with no prompt
# text (built again in the language in use on delivery), names the cursor's next beat by `beatId`, and
# stamps a frame inside an option with its `choiceId`. Version 3 still loads: its cursor's `beatIndex`
# is trusted as it always was, and its options' prompt text is discarded. Version 2, and the
# snake_case shape this addon wrote before 0.11.0, no longer load.

## Selector cursors in the family's shape: every key optional, present once used - `seq` after the
## first sequential pick, `bag` once a shuffle has drawn, `last` once there is a no-repeat memory.
## The live entries carry `bag_init`, which is not written: a present `bag` means the same thing.
static func _save_selectors(live: Dictionary) -> Dictionary:
	var out := {}
	for id in live:
		var st: Dictionary = live[id]
		var s := {}
		if st.has("seq"):
			s["seq"] = st["seq"]
		if st.has("bag"):
			s["bag"] = (st["bag"] as Array).duplicate()
		if st.has("last"):
			s["last"] = st["last"]
		out[id] = s
	return out


static func _load_selectors(saved) -> Dictionary:
	var out := {}
	if not (saved is Dictionary):
		return out
	for id in saved:
		var s: Dictionary = saved[id]
		var st := {}
		if s.has("seq"):
			st["seq"] = int(s["seq"])
		if s.has("bag"):
			st["bag"] = (s["bag"] as Array).duplicate()
			st["bag_init"] = true
		if s.has("last"):
			st["last"] = s["last"]
		out[id] = st
	return out


## Live frames are {scene, container, index}; the save carries {sceneId, containerId, index, nextId?,
## choiceId?}. Each frame is stamped with the id of the child it would run next, so a restore against an
## EDITED bundle re-finds the position by id rather than trusting the raw index (spec 9.8). A frame at its
## container's end has no next child and no stamp. A frame an option's content runs in carries its
## choice (choiceId), to be offered again if the option has gone.
func _snapshot_stack() -> Array:
	var out: Array = []
	for f in _stack:
		var frame := {"sceneId": f["scene"], "containerId": f["container"], "index": int(f["index"])}
		var children = _children_of(f["container"])
		if children != null:
			var kids: Array = children
			var idx: int = int(f["index"])
			if idx < kids.size():
				frame["nextId"] = (kids[idx] as Dictionary)["id"]
		if _host.option_choice.has(f["container"]):
			frame["choiceId"] = _host.option_choice[f["container"]]
		out.append(frame)
	return out


## THIS flow's own kernel bags: its not-shared @patter half and its per-scene @scene props,
## each prefixed with the flow id so one path space holds every flow. The shared halves are
## the engine's list_bags.
func list_bags() -> Array:
	var mounts: Array = [{"bag": _local, "path_prefix": "%s/@patter." % id}]
	for sid in _scene_bags:
		mounts.append({"bag": _scene_bags[sid], "path_prefix": "%s/@scene:%s." % [id, sid]})
	return mounts


func snapshot() -> Dictionary:
	var pending = null
	if _pending != null:
		# Which options, never their text: a prompt is built again in the language in use whenever the
		# choice is delivered. An option's extension values are the bundle's, read off its node again.
		var saved_opts: Array = []
		for o in _pending["options"]:
			var so := {"id": o["id"], "eligible": o["eligible"]}
			if o.get("gameData") is Dictionary:
				so["gameData"] = _norm_gamedata(o["gameData"])
			saved_opts.append(so)
		pending = {"groupId": _pending["group_id"], "options": saved_opts}
	var cursor := {
		"flowEnded": _flow_ended,
		"currentSceneId": _current_scene_id if _current_scene_id != "" else null,
		"stack": _snapshot_stack(),
		"activeSnippetId": _active_snippet["id"] if _active_snippet != null else null,
		"pendingChoice": pending,
		"pendingPromptOwnerId": _pending_prompt_owner if _pending_prompt_owner != "" else null,
		"selectors": _save_selectors(_selectors),
	}
	# Why it ended, when a choice running dry ended it: so a loaded game reports the same end.
	if _ran_dry != "":
		cursor["ranDry"] = _ran_dry
	# The next beat by id, so an edit to the snippet can't move it; none once every beat is delivered.
	if _active_snippet != null:
		var beats: Array = _active_snippet.get("beats", [])
		if _beat_index < beats.size():
			cursor["beatId"] = beats[_beat_index]["id"]
	# The prompt still to replay, as the choice showed it: written only in the choose->advance window.
	if _pending_prompt_shown != null:
		cursor["pendingPrompt"] = (_pending_prompt_shown as Dictionary).duplicate()
	# The cursor, PRNG and visits. This flow's properties are the registry's, saved with it.
	return {
		"rngState": _prng.a,
		"visits": _visit_counts.duplicate(true),
		"cursor": cursor,
	}


## Restore this flow from a snapshot: its cursor, PRNG, visits, and selector cursors. Its property
## values are the registry's and stay as they are (a load puts the saved ones there first). A place
## that has gone from the build resumes at the nearest safe point, reported through on_error ("save").
## Refused (push_error, nothing changed) while a checkpoint is open.
func restore(snap: Dictionary) -> void:
	if _host.journal != null:
		push_error("a flow can't be restored while a checkpoint is open")
		return
	var drift := _restore_cursor(snap)
	# Register this flow's bags: each claims the values the registry holds for it (loaded by the game,
	# by load_game from the save, or handed back by the engine this one replaces), laid over fresh
	# defaults. Released KEEPING their values, so a live flow restored in place keeps its property
	# values (a fresh one, made by a load, is claiming the loaded values either way). The scenes the
	# cursor stands in are registered now; any other scene's bag is claimed on entry. A flow state's
	# own "scopes" / "sceneBags" were moved into the registry by PatterEngine.restore_flow before this ran.
	_release_bags(true)
	_mount_local()
	var here := {}
	if _current_scene_id != "":
		here[_current_scene_id] = true
	for f in _stack:
		here[f["scene"]] = true
	for s in here:
		if _host.bundle["scenes"].has(s):
			_ensure_scene_bags(s)
	# Only now, with the values back, can a choice be offered again: its conditions read them.
	if not drift.is_empty():
		_report({"flow": id, "kind": "save", "node": drift["node"],
			"message": "the save's place has gone from this build: " + str(drift["instead"])})
		if drift.has("reoffer"):
			_setup_choice(drift["reoffer"])


## The cursor half of restore(): cursor, PRNG, visits, and selector cursors, without touching the bags.
## Returns where the saved place had gone, or {} when it hadn't: {"node": the report's node (the saved
## snippet, or at a pending choice its group), "instead": what has gone and what the flow does instead,
## "reoffer"?: the choice group to offer again}.
func _restore_cursor(snap: Dictionary) -> Dictionary:
	var c: Dictionary = snap["cursor"]
	# Through to_uint32, not a bare mask: the JS runtime persisted this state SIGNED until it was fixed,
	# so saves in the wild carry a negative number here.
	_prng.a = PatterMulberry32.to_uint32(float(snap.get("rngState", 0)))
	_visit_counts = (snap.get("visits", {}) as Dictionary).duplicate(true)
	_started = true
	_flow_ended = bool(c.get("flowEnded", false))
	_dry_choice = ""
	var rd = c.get("ranDry")
	_ran_dry = str(rd) if _flow_ended and rd is String else ""
	var csid = c.get("currentSceneId")
	_current_scene_id = str(csid) if csid != null else ""
	var asid = c.get("activeSnippetId")
	var saved_snippet := str(asid) if asid != null and str(asid) != "" else ""
	var pc = c.get("pendingChoice")
	var drift := {}
	# Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives siblings inserted /
	# removed / reordered before the cursor); fall back to the raw index when the id is absent (at the
	# container's end) or its node drifted out of the bundle (spec 9.8 best-effort). A frame whose OPTION
	# has gone, with its choice still there, ends the stack: the choice is offered again.
	_stack = []
	for saved_frame in (c.get("stack", []) as Array):
		var sf: Dictionary = saved_frame
		var f := {"scene": str(sf.get("sceneId", "")), "container": str(sf.get("containerId", "")), "index": int(sf.get("index", 0))}
		var children = _children_of(f["container"])
		var choice_id = sf.get("choiceId")
		if children == null and choice_id != null and _host.node_index.has(str(choice_id)):
			var choice: Dictionary = _host.node_index[str(choice_id)]
			if choice.get("type", "") == "group" and choice.get("selector", "") == "choice":
				var node := saved_snippet
				if node == "":
					node = str(pc.get("groupId", "")) if pc is Dictionary else f["container"]
				drift = {"node": node, "reoffer": choice,
					"instead": "option %s has gone, so choice %s is offered again" % [f["container"], choice["id"]]}
				break
		var next_id = sf.get("nextId")
		if next_id != null and children != null:
			var kids: Array = children
			for i in range(kids.size()):
				if (kids[i] as Dictionary)["id"] == str(next_id):
					f["index"] = i
					break
		_stack.append(f)

	# Content-drift policy (spec 9.8): if a saved position points at content deleted since the save, resume
	# at the nearest safe point rather than refusing. A gone snippet is skipped: play carries on from the
	# surviving stack. A gone NEXT beat in a surviving snippet finishes the snippet (its onExit and jump
	# run), so nothing plays twice. A version 3 save names the beat by its raw index, trusted as it was.
	_active_snippet = null
	_beat_index = 0
	if not drift.has("reoffer") and saved_snippet != "":
		var node: Dictionary = _host.node_index.get(saved_snippet, {})
		if node.get("type", "") == "snippet":
			var beats: Array = node.get("beats", [])
			_active_snippet = node
			var beat_id = c.get("beatId")
			if beat_id != null:
				var at := -1
				for i in range(beats.size()):
					if beats[i]["id"] == str(beat_id):
						at = i
						break
				_beat_index = at if at >= 0 else beats.size()
				if at < 0:
					drift = {"node": saved_snippet,
						"instead": "beat %s has gone from snippet %s, so the snippet ends there" % [beat_id, saved_snippet]}
			else:
				# Version 4 writes no beat once every one is delivered.
				var bi = c.get("beatIndex")
				_beat_index = int(bi) if bi != null else beats.size()
		else:
			drift = {"node": saved_snippet, "instead": "snippet %s has gone, so play carries on after it" % saved_snippet}

	_selectors = _load_selectors(c.get("selectors", {}))

	# Replay the saved option set VERBATIM (schema 9.3): re-deriving would re-evaluate conditions
	# (double-consuming PRNG draws) and could change the choice under the player. Prompts are not in the
	# save (a version 3 save's are discarded): they are built when the choice is delivered. Options whose
	# nodes drifted out of the bundle are dropped. A choice with no surviving option is offered again, when
	# its group is still there, or dissolves (9.8).
	_pending = null
	if not drift.has("reoffer") and pc is Dictionary:
		var group_id := str(pc.get("groupId", ""))
		var options: Array = []
		var by_id: Dictionary = {}
		for o in (pc.get("options", []) as Array):
			var oid := str(o.get("id", ""))
			if not _host.node_index.has(oid):
				continue
			by_id[oid] = _host.node_index[oid]
			var opt := {"id": oid, "eligible": bool(o.get("eligible", false))}
			if o.get("gameData") is Dictionary:
				opt["gameData"] = o["gameData"]
			options.append(opt)
		if not options.is_empty():
			_pending = {"group_id": group_id, "options": options, "by_id": by_id, "shown": {}}
		else:
			var group: Dictionary = _host.node_index.get(group_id, {})
			if group.get("type", "") == "group" and group.get("selector", "") == "choice":
				drift = {"node": group_id, "reoffer": group,
					"instead": "none of choice %s's options is left, so it's offered again" % group_id}
			else:
				drift = {"node": group_id, "instead": "choice %s has gone, so play carries on after it" % group_id}

	# A save taken between choose() and the next advance() left a prompt still to be replayed: the chosen
	# option's authored prompt beat, found again by its owner, and the prompt as the choice showed it,
	# carried by the save. A save from before pendingPrompt existed has only the owner, and its beat is
	# resolved when delivered, as it was then. Dropped if the option drifted out of the bundle or has no
	# authored prompt (spec 9.8): the live choose() would replay nothing.
	_pending_prompt_beat = null
	_pending_prompt_shown = null
	var ppo = c.get("pendingPromptOwnerId")
	_pending_prompt_owner = str(ppo) if ppo != null and not drift.has("reoffer") else ""
	if _pending_prompt_owner != "" and _host.node_index.has(_pending_prompt_owner):
		_pending_prompt_beat = _authored_prompt_of(_host.node_index[_pending_prompt_owner])
	if _pending_prompt_beat == null:
		_pending_prompt_owner = ""
	elif c.get("pendingPrompt", null) is Dictionary:
		_pending_prompt_shown = (c["pendingPrompt"] as Dictionary).duplicate()
		var beat_id: String = _pending_prompt_beat["id"]
		_pending_prompt_shown["padAfter"] = _saved_pad(_pending_prompt_shown, func(): return _pad_of(beat_id))
		# A save from before prompts carried a speaker's label works it out again, from the speaker the
		# choice showed, in the current locale.
		if _pending_prompt_shown.get("kind", "") == "line" and not _pending_prompt_shown.has("speakerLabel"):
			var label = _speaker_label_of(_host, _pending_prompt_shown.get("character"), _pending_prompt_shown.get("qualifier"))
			if label != null:
				_pending_prompt_shown["speakerLabel"] = label
	return drift
