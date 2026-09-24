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

var id: String
var _host: Dictionary
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
var _pending = null                   # { "group_id":, "options":[normalised], "by_id":{id:node} } or null
var _pending_prompt_beat = null       # beat Dictionary or null
var _pending_prompt_owner: String = "" # chosen option owning _pending_prompt_beat, re-derivable across a save in the choose->advance window
var _selectors: Dictionary = {}
var _visit_counts: Dictionary = {}
var _eval_ctx: Dictionary
var _dialect: Dictionary = PatterDialect.dialect()


func _init(host: Dictionary, seed_value: float) -> void:
	_host = host
	_prng = PatterMulberry32.new(seed_value)
	_local = _fresh_local()   # registered by start() / restore()
	_eval_ctx = {
		"scopes": {},   # filled from the registry by _context()
		"next_random": func(): return _rng(),
		"visits": func(nid): return _visit_counts.get(nid, 0),
		"patter_visits": func(nid): return _host["shared_visits"].get(nid, 0),
		# The quality channel: a property's stage ladder, from wherever the declaration lives -
		# @patter decls, the CURRENT scene's decls (they move with the flow), or the registry.
		"qualities": func(scope, name): return _stages_for(scope, name),
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
	var reg = _host["registry"]
	if reg.revision != _ctx_revision:
		var base: Dictionary = reg.to_eval_context()
		var scopes: Dictionary = (base.get("scopes", {}) as Dictionary).duplicate()
		scopes["patter"] = func(n): return _patter_get(n)
		scopes["scene"] = func(n): return _scene_get(n)
		_eval_ctx["scopes"] = scopes
		_registry_qualities = base.get("qualities")
		_ctx_revision = reg.revision
	return _eval_ctx


func current_scene() -> String:
	return _current_scene_id


# The stage ladder of "@scope.name" when it is a declared quality, else null. Names compare
# lowercase, as the compiler emits references. Mirrors the JS Flow.stagesFor.
func _stages_for(scope: String, name: String):
	var key := name.to_lower()
	var from_decls := func(decls):
		if decls == null:
			return null
		for d in decls:
			if d.get("type", "") == "quality" and str(d.get("name", "")).to_lower() == key:
				return d.get("stages")
		return null
	if scope == "patter":
		var hit = from_decls.call(_host.get("patter_shared_decls"))
		return hit if hit != null else from_decls.call(_host.get("patter_local_decls"))
	if scope == "scene":
		if _current_scene_id == "" or not _host["bundle"]["scenes"].has(_current_scene_id):
			return null
		return from_decls.call(_host["bundle"]["scenes"][_current_scene_id].get("sceneProps"))
	# Any other scope's ladder is the registry's (another engine's `@story`, the game's `@world`),
	# with the bundle's own host-scope declarations behind it for a game that registered `@world`
	# undeclared.
	if _registry_qualities is Callable:
		var hit = (_registry_qualities as Callable).call(scope, name)
		if hit != null:
			return hit
	for spec in _host["bundle"].get("scopeRegistry", {}).get("scopes", []):
		if spec.get("token", "") == scope:
			return from_decls.call(spec.get("declarations"))
	return null


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
	return {"played": played, "stop": {"type": "end"}}


# Send this flow's cursor to an ADDRESS, exactly as an authored `go` jump would: the target scene's
# onEntry runs, entering counts as a visit, and the callstack is REPLACED (pending call-returns
# discarded). `scene`/`block` are host-facing gameIds (spec §6) or internal ids; `block` is scene-scoped.
# "END" ends the flow. HOST navigation, so it lands IMMEDIATELY: the rest of the snippet being delivered
# is abandoned and a pending choice dropped. An unstarted flow starts here; an ended one resumes.
# Returns false - cursor untouched - if the address does not resolve. MOVES, never resets.
func goto(scene: String, block: String = "") -> bool:
	if _closed:
		return false  # closed is terminal: unlike "ended", a goto cannot revive it
	if scene == "END":
		_started = true
		_pending = null
		_pending_prompt_beat = null
		_pending_prompt_owner = ""
		_active_snippet = null
		_beat_index = 0
		_flow_ended = true
		_stack = []
		return true
	# Resolve BOTH addresses before touching state, so a bad one is a no-op rather than a half-move.
	var bundle: Dictionary = _host["bundle"]
	var scene_id: String = ""
	if _host["scene_gameid_to_id"].has(scene):
		scene_id = _host["scene_gameid_to_id"][scene]
	elif bundle["scenes"].has(scene):
		scene_id = scene
	if scene_id == "":
		return false
	var block_id: String = ""
	if block != "":
		var addrs: Dictionary = _host["block_gameid_to_id"].get(scene_id, {})
		if addrs.has(block):
			block_id = addrs[block]
		elif _host["block_to_scene"].get(block, "") == scene_id:
			block_id = block
		if block_id == "":
			return false  # a block address is scene-scoped: unknown HERE is unknown
	if not _started:
		start(scene_id, block_id)
		return true

	_pending = null
	_pending_prompt_beat = null
	_pending_prompt_owner = ""
	_active_snippet = null
	_beat_index = 0        # abandon the rest of the snippet being delivered
	_flow_ended = false    # an ended flow resumes at the target
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
	_pending = null
	_pending_prompt_beat = null
	_pending_prompt_owner = ""


# True once the engine has closed this flow.
func is_closed() -> bool:
	return _closed


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
	if not _host["log_enabled"]:
		return
	var scene = _current_scene_id if _current_scene_id != "" else null
	var entry := event.duplicate()
	entry["seq"] = _seq
	_seq += 1
	if scene != null:
		entry["scene"] = scene
	_log.append(entry)
	# The engine's stream is the same Array instance, appended to directly: a callback
	# would have to close over the engine, and that cycle is what test_debug_registry
	# refuses. Each entry names its flow, since a run is several flows in one order.
	var shared: Array = _host["engine_log"]
	var wide := entry.duplicate()
	wide["flow"] = id
	wide["seq"] = shared.size()
	shared.append(wide)


func get_choices() -> Array:
	return _pending["options"] if _pending != null else []


func is_ended() -> bool:
	return _flow_ended


# -- host API ------------------------------------------------------------------

func start(scene_id: String, block_id: String) -> void:
	# A start is a reset: this flow's bags go, and so does anything a load left waiting for them.
	_release_bags(false)
	_host["registry"].discard_parked(key_flow(id))
	_mount_local()
	_selectors = {}
	_visit_counts = {}
	_stack = []
	_current_scene_id = ""
	_flow_ended = false
	_active_snippet = null
	_beat_index = 0
	_pending = null
	_started = true

	var bundle: Dictionary = _host["bundle"]
	if block_id != "":
		if not _host["block_to_scene"].has(block_id):
			push_error("unknown block: " + block_id)
			return
		var bsid: String = _host["block_to_scene"][block_id]
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
	if _closed:
		return {"type": "end"}  # a stale reference to a closed flow drives nothing
	if not _started:
		push_error("flow has not been started")
		return {"type": "end"}
	if _pending_prompt_beat != null:
		var b = _pending_prompt_beat
		_pending_prompt_beat = null
		_pending_prompt_owner = ""
		return _beat_result(b)
	_settle()
	if _flow_ended:
		return {"type": "end"}
	if _pending != null:
		return {"type": "choice", "options": _pending["options"]}
	if _active_snippet == null:
		_flow_ended = true
		return {"type": "end"}
	var beat = _active_snippet.get("beats", [])[_beat_index]
	_beat_index += 1
	return _beat_result(beat)


func choose(option_id: String) -> void:
	if _pending == null:
		push_error("no choice is pending")
		return
	if not _pending["by_id"].has(option_id):
		push_error("unknown choice option: " + option_id)
		return
	var node = _pending["by_id"][option_id]
	_emit({"type": "chose", "group": _pending["group_id"], "option": option_id})
	_pending = null
	_pending_prompt_beat = _prompt_beat_of(node) if _host["replay_prompt_on_choose"] else null
	_pending_prompt_owner = node["id"] if _pending_prompt_beat != null else ""
	_enter_child(node)


func get_property(ref: String):
	var sp := split_host_ref(_host, ref)
	if sp[0] == "patter":
		return _patter_get(sp[1])
	if sp[0] == "scene":
		return _scene_get(sp[1])
	return _host["registry"].get_value(sp[0], sp[1])   # host scopes, other engines' scopes


## Write a property by ref. The GAME's surface, so it writes with HOST authority: a host
## declaration's "writable": false binds the story, not the game that owns the value. The story's
## own writes (effects) go through _write_property(.., false).
func set_property(ref: String, value) -> void:
	_write_property(ref, value, true)


## The write itself. `host` says WHO is writing, which is all "writable": false cares about.
func _write_property(ref: String, value, host: bool) -> void:
	var sp := split_host_ref(_host, ref)
	if sp[0] == "patter":
		_patter_set(sp[1], value)
	elif sp[0] == "scene":
		if _current_scene_id == "":
			push_error("'%s': the flow has not entered a scene yet" % ref)
			return
		_scene_set(sp[1], value)
	else:
		# Host scopes and other engines' scopes. "writable": false is the STORY's promise, so the
		# registry refuses a story write (push_error, no write) and lets the game's own through.
		_host["registry"].set_value(sp[0], sp[1], value, {"host": true} if host else {})


# -- scope resolvers -----------------------------------------------------------

func _patter_get(n: String):
	if _host["patter_shared_names"].has(n):
		return _host["shared_patter"].get_value(n)
	return _local.get_value(n)


func _patter_set(n: String, v) -> void:
	if _host["patter_shared_names"].has(n):
		_host["registry"].set_value("patter", n, v)
	else:
		_local.set_value(n, v)


## The bag a `@scene` property of the current scene lives in (the scene's stage bag, or this flow's),
## made and registered if missing.
func _scene_bag_for(n: String):
	var s := _current_scene_id
	if s == "" or not _host["bundle"]["scenes"].has(s):
		return null
	_ensure_scene_bags(s)
	var shared: bool = _host["scene_shared_names"].get(s, {}).has(n.to_lower())
	if shared:
		return _host["stage_bags"].get(s)
	return _scene_bags.get(s)


func _scene_get(n: String):
	var bag = _scene_bag_for(n)
	# get_value, NOT get: these are PatterPropertyBag objects now, and Object.get(n) is a
	# lookup of the MEMBER named n, which would quietly answer null for every property.
	return bag.get_value(n) if bag != null else null


func _scene_set(n: String, v) -> void:
	var bag = _scene_bag_for(n)
	if bag != null:
		# Not silent: an engine write notifies subscribers and is audited, where a host
		# write is silent but still audited. This is the engine's own write.
		bag.set_value(n, v)


# -- settle / entry ------------------------------------------------------------

func _settle() -> void:
	var transitions := 0
	while true:
		transitions += 1
		if transitions > 10000:
			push_error("flow did not settle after 10000 transitions")
			return
		if _flow_ended or _pending != null:
			return

		if _active_snippet != null:
			if _beat_index < _active_snippet.get("beats", []).size():
				return
			_run_effects(_active_snippet.get("onExit", []))
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
		if _host["log_enabled"] and frame["index"] != _from:
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
	var bundle: Dictionary = _host["bundle"]
	if not bundle["scenes"].has(scene_id):
		push_error("unknown scene: " + scene_id)
		return
	var scene: Dictionary = bundle["scenes"][scene_id]
	_current_scene_id = scene_id
	_enter(scene_id)
	_seed_scene(scene)
	_run_effects(scene.get("onEntry", []))


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
	if _host["block_by_id"].has(container_id):
		return _host["block_by_id"][container_id]["children"]
	if _host["node_index"].has(container_id):
		var node: Dictionary = _host["node_index"][container_id]
		if node.get("type", "") == "group":
			return node.get("children", [])
	return null


func _begin_snippet(snippet: Dictionary) -> void:
	_run_effects(snippet.get("onEnter", []))
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
		var opt := {"id": child["id"], "eligible": elig}
		var text = _prompt_text(child)
		if text != null:
			opt["text"] = text
		if child.has("gameData"):
			opt["gameData"] = _norm_gamedata(child["gameData"])
		options.append(opt)
		by_id[child["id"]] = child
	if not options.is_empty():
		# Including the ones a condition left ineligible: "why is that greyed out" is a
		# question about the moment the choice was built.
		var offered: Array = []
		for o in options:
			offered.append({"id": o["id"], "eligible": o["eligible"]})
		_emit({"type": "choice", "group": group["id"], "options": offered})
		_pending = {"group_id": group["id"], "options": options, "by_id": by_id}
		return
	for f in fallbacks:
		if _eligible(f):
			_enter_child(f)
			return
	# Nothing takeable and no eligible fallback: the choice runs dry and the flow walks past
	# it. The behaviour is unchanged; this makes the silent fall-through observable.
	_emit({"type": "dry", "group": group["id"]})
	# Beside the log, not instead of it: the callback is live feedback a host acts on, the
	# log is an audit read afterwards, and a shipped game runs with the log off and this
	# still wired. Parity with the JS runtime's onDryChoice, which the ports never had.
	var on_dry = _host.get("on_dry_choice")
	if on_dry is Callable and (on_dry as Callable).is_valid():
		(on_dry as Callable).call(group["id"])


# -- jumps ---------------------------------------------------------------------

func _resolve_jump(jump) -> void:
	if jump == null:
		return
	_enter_target(jump["to"], "call" if jump.get("mode", "") == "call" else "jump")


func _enter_target(to: String, mode: String) -> void:
	_emit({"type": "jump", "to": to, "mode": mode})
	if to == "END":
		_flow_ended = true
		_stack = []
		return
	var bundle: Dictionary = _host["bundle"]
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
		if not _host["block_to_scene"].has(to):
			push_error("jump target not found: " + to)
			return
		var sid: String = _host["block_to_scene"][to]
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
	if not st.has("bag_init"):
		st["bag"] = _fill_ids(eligible, stick, ln)
		st["bag_init"] = true
	if (st["bag"] as Array).is_empty():
		if exhaust == "once":
			return null
		if stick:
			var last_node = eligible[ln - 1]
			st["last"] = last_node["id"]
			return last_node
		st["bag"] = _fill_ids(eligible, stick, ln)
	# Draw without replacement, never repeating the immediately-previous pick - allocation-free:
	# find last's slot and draw into the reduced span skipping it, then erase the pick in place.
	var bag: Array = st["bag"] as Array
	var p := (bag.find(st["last"]) if (st.has("last") and bag.size() > 1) else -1)
	var span := (bag.size() - 1 if p >= 0 else bag.size())
	var i := int(floor(_rng() * span))
	if p >= 0 and i >= p:
		i += 1
	var pick = bag[i]
	bag.remove_at(i) # draw without replacement, in place
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
	var truthy := func(n: Array) -> bool: return PatterValues.truthy(_spec_atom(n, ctx))
	return PatterSpecificity.matched_specificity(node["condition"]["ast"], truthy)


# One atom's value for specificity scoring. An eval error scores as false, the
# same reading the JS scorer gives a throwing atom.
static func _spec_atom(node: Array, ctx: Dictionary) -> Variant:
	var v = PatterExpr.evaluate(node, ctx, PatterDialect.dialect())
	return false if PatterExpr.is_error(v) else v


func _fill_ids(eligible: Array, stick: bool, ln: int) -> Array:
	var ids: Array = []
	var upto := (ln - 1) if stick else ln
	for i in upto:
		ids.append(eligible[i]["id"])
	return ids


func _selector_state_for(group: Dictionary) -> Dictionary:
	var map: Dictionary = _host["shared_selectors"] if group.get("shared", false) else _selectors
	if not map.has(group["id"]):
		map[group["id"]] = {}
	return map[group["id"]]


# -- effects / expressions -----------------------------------------------------

func _run_effects(effects: Array) -> void:
	for e in effects:
		var v = _eval_expr(e["value"])
		# An effect whose value does not evaluate writes NOTHING. Before the
		# evaluator could refuse, a bad expression silently stored its fallback
		# (0.0, or false) into the property, which is a corrupted save rather
		# than a caught bug.
		if PatterExpr.is_error(v):
			push_error("effect on '%s' did not evaluate: %s" % [e["target"], v.message])
			continue
		# `prev` read before the write, so a reader can say "0 -> 1" in one pass. Only
		# paid for when the run asked for a log.
		var prev = get_property(e["target"]) if _host["log_enabled"] else null
		_write_property(e["target"], v, false)   # the STORY writes: a read-only host property refuses it
		var ev := {"type": "write", "target": e["target"], "value": v}
		if prev != null:
			ev["prev"] = prev
		_emit(ev)


func _eligible(node: Dictionary) -> bool:
	if not node.has("condition"):
		return true
	var v = _eval_expr(node["condition"])
	# An eval error is never a silent pass: the node is ineligible and the
	# diagnostic surfaces. truthy() would answer false for an EvalError anyway;
	# this says it on purpose, and reports why.
	if PatterExpr.is_error(v):
		push_error("condition did not evaluate: %s" % v.message)
		return false
	return PatterValues.truthy(v)


func _eval_expr(expr: Dictionary):
	return PatterExpr.evaluate(expr["ast"], _context(), _dialect)


func _enter(nid: String) -> void:
	_visit_counts[nid] = _visit_counts.get(nid, 0) + 1
	_host["shared_visits"][nid] = _host["shared_visits"].get(nid, 0) + 1


func _rng() -> float:
	var custom = _host.get("custom_rng")
	if custom != null:
		return custom.call()
	return _prng.next()  # the same mixing as PatterMulberry32.next(), no longer duplicated inline


# -- strings / beats -----------------------------------------------------------

func _beat_result(beat: Dictionary) -> Dictionary:
	var kind: String = beat["kind"]
	# Accumulated author tags (#215): omitted from the step when empty (parity with gameData).
	var tags: Array = _host["tag_index"].get(beat["id"], [])
	if kind == "gameEvent":
		var ra := {"type": "gameEvent", "id": beat["id"]}
		if beat.has("gameData"):
			ra["gameData"] = _norm_gamedata(beat["gameData"])
		if not tags.is_empty():
			ra["tags"] = tags
		return ra
	if kind == "text":
		var rt := {"type": "text", "id": beat["id"], "text": _interp(_resolve_string(beat["id"]))}
		if beat.has("gameData"):
			rt["gameData"] = _norm_gamedata(beat["gameData"])
		if not tags.is_empty():
			rt["tags"] = tags
		return rt
	# line
	var raw := _resolve_string(beat["id"])
	var r := {"type": "line", "id": beat["id"]}
	# Closed captions (#214): a line goes SILENT (off only) when the caption CHARACTER speaks it (whole line
	# is a caption, delimiters or not) OR stripping cues leaves it empty. A silent line still fires (audio
	# plays) but carries no text + no speaker.
	var cc_off: bool = not _host["captions_on"]
	var caption_char: bool = cc_off and beat.get("character", "") == _host["caption_character"]
	var presented := "" if caption_char else _caption_line(raw if _host["bundle"].get("voiced", false) else _interp(raw))
	r["text"] = presented
	var silent: bool = cc_off and presented == ""
	if not silent:
		if beat.has("character"):
			r["character"] = beat["character"]
		var cn = _resolve_character_name(beat.get("character", ""))
		if cn != null:
			r["characterName"] = cn
		if beat.has("direction"):
			r["direction"] = beat["direction"]
	if beat.has("gameData"):
		r["gameData"] = _norm_gamedata(beat["gameData"])
	if not tags.is_empty():
		r["tags"] = tags
	return r


func _norm_gamedata(gd: Dictionary) -> Dictionary:
	var out := {}
	for k in gd.keys():
		out[k] = PatterValues.to_value(gd[k])
	return out


func _interp(raw: String) -> String:
	return PatterInterp.expand(raw, func(ref): return get_property(ref))


# Caption-strip a dialogue line ONLY when captions are off; otherwise pass it through (#214).
func _caption_line(text: String) -> String:
	return text if _host["captions_on"] else PatterInterp.strip_captions(text, _host["caption_open"], _host["caption_close"])


# Public: apply the project's caption rule UNCONDITIONALLY (#214). An IDs-only game calls this on a string
# it looked up in its OWN loc system (after interpolate) when its captions are off.
func strip_captions(text: String) -> String:
	return PatterInterp.strip_captions(text, _host["caption_open"], _host["caption_close"])


# Public: expand {@ref} slots against this flow's CURRENT state. An IDs-only game calls this on a string it
# looked up in its OWN loc system for a beat id the engine emitted, to apply property replacement.
func interpolate(text: String) -> String:
	return _interp(text)


func _prompt_text(node: Dictionary):
	var beat = _prompt_beat_of(node)
	if beat == null:
		return null
	var text := _interp(_resolve_string(beat["id"]))
	# A line-kind prompt is dialogue, so captions apply; a text-kind prompt is left as-is (#214).
	return _caption_line(text) if beat["kind"] == "line" else text


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
	if _host["emit_ids"]:
		return sid  # IDs-only build: the game resolves text from this id itself
	if _host["strings"].has(sid):
		return _host["strings"][sid]
	if _host["default_strings"].has(sid):
		return "<Untranslated: %s> %s" % [sid, _host["default_strings"][sid]]
	return sid


func _resolve_character_name(character: String):
	if character == "":
		return null
	if _host["emit_ids"]:
		return null  # IDs-only: omit the display name; the game maps the `character` token
	var key := "cast:" + character
	if _host["strings"].has(key):
		return _host["strings"][key]
	if _host["default_strings"].has(key):
		return _host["default_strings"][key]
	if _host["cast_display"].has(character):
		return _host["cast_display"][character]
	return null


func _seed_scene(scene: Dictionary) -> void:
	var shared: Dictionary = _host["scene_shared_names"].get(scene["id"], {})
	_ensure_scene_bags(scene["id"])
	for decl in scene.get("sceneProps", []):
		if not decl.get("temporary", false):
			continue
		var tnm: String = str(decl["name"]).to_lower()
		var target_bag = _host["stage_bags"][scene["id"]] if shared.has(tnm) else _scene_bags[scene["id"]]
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
	var shared: Dictionary = _host["scene_shared_names"].get(s, {})
	var props: Array = _host["bundle"]["scenes"].get(s, {}).get("sceneProps", [])
	if not _scene_bags.has(s):
		var bag = PatterPropertyBag.new(_props_for(props, shared, false), {"path_prefix": "@scene."})
		var key := key_flow_scene(id, s)
		if _host["registry"].mount_owned(key, bag, {"owner": OWNER}) == "":
			_registered[key] = true
		_scene_bags[s] = bag
	if not _host["stage_bags"].has(s):
		var bag = PatterPropertyBag.new(_props_for(props, shared, true), {"path_prefix": "@scene."})
		_host["registry"].mount_owned(key_stage(s), bag, {"owner": OWNER})
		_host["stage_bags"][s] = bag


func _fresh_local():
	# This flow's NOT-shared @patter half, in a bag for the same reasons as the shared one.
	return PatterPropertyBag.new(_host["patter_local_decls"], {"path_prefix": "@patter."})


## Register a fresh globals bag under this flow's key; it claims any values waiting there.
func _mount_local() -> void:
	_local = _fresh_local()
	var key := key_flow_globals(id)
	if _host["registry"].mount_owned(key, _local, {"owner": OWNER}) == "":
		_registered[key] = true


## Engine-driven (close, load_game, hot_swap): remove every bag this flow registered. With `keep`,
## their values wait in the registry for the flow that replaces this one.
func _release_bags(keep: bool) -> void:
	for key in _registered:
		if _host["registry"].has(key):
			_host["registry"].remove(key, {"keep": keep})
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


## Split a ref into [scope, name] against the registry's current tokens (`@scene` is always the
## flow's). Memoised per ref on the engine's host; the memo is dropped when the registry's set of
## scopes moves.
static func split_host_ref(host: Dictionary, ref: String) -> Array:
	var reg = host["registry"]
	if host["split_revision"] != reg.revision:
		host["split_cache"] = {}
		host["split_revision"] = reg.revision
	var cache: Dictionary = host["split_cache"]
	if not cache.has(ref):
		cache[ref] = PatterBundle.split_ref_with(ref, func(t: String) -> bool:
			return t == "scene" or reg.has(t))
	return cache[ref]


## A version 2 save's property values, as registry sections under the engine's keys. Reads the
## family's camelCase shape and the snake_case one this addon wrote before 0.11.0.
static func sections_from_v2(save: Dictionary) -> Dictionary:
	var out := {}
	if save.get("shared") is Dictionary:
		out["patter"] = _unwrap_scope(save["shared"], "patter")
	var stage = _k(save, "stageBags", "stage_bags")
	if stage is Dictionary:
		for sid in stage:
			out[key_stage(str(sid))] = stage[sid]
	var flows = save.get("flows", {})
	if flows is Dictionary:
		for fid in flows:
			var f = flows[fid]
			if not (f is Dictionary):
				continue
			if f.get("scopes") is Dictionary:
				out[key_flow_globals(str(fid))] = _unwrap_scope(f["scopes"], "patter")
			var bags = _k(f, "sceneBags", "scene_bags")
			if bags is Dictionary:
				for sid in bags:
					out[key_flow_scene(str(fid), str(sid))] = bags[sid]
	return out


# -- save / restore ------------------------------------------------------------

# The stack, each frame stamped with the id of the child it would run next (mirrors the JS
# runtime's StackFrame.nextId): a frame saved at its container's end gets no stamp.
# -- the save shape --------------------------------------------------------------
#
# A save is written in the FAMILY's shape: `patter/save@0`, the JS reference's, documented in
# @patterkit/model and design/patter-schema.md 9. camelCase literal keys, the execution position
# under `cursor`, a pending choice as `{groupId, options}`, selector cursors with every key optional.
# Every Patterplay runtime writes and reads exactly this, so a save crosses engines. Version 3 holds no
# property values: those are the registry's, carried under `registry` only when the engine made its
# own. Version 2 carried them itself (`shared`, `stageBags`, each flow's `scopes` and `sceneBags`) and
# still loads, its values moving into the registry (sections_from_v2). Until 0.11.0 this addon wrote snake_case keys with the cursor fields flat,
# which loaded nowhere else and refused a JS save on its first key
# (from-storylets/save-shape-across-engines, 2026-09-03); restore() and load_game() still READ that
# shape, so a player's save on disk keeps loading.

## Read `canonical` if present, else the pre-0.11.0 `legacy` key, else null.
static func _k(d: Dictionary, canonical: String, legacy: String):
	if d.has(canonical):
		return d[canonical]
	return d.get(legacy, null)


## A scope map is `{"patter": {name: value}}` in the family's shape; this addon wrote the inner map
## bare. A bare map's values are scalars and arrays, never Dictionaries, which tells the two apart.
static func _unwrap_scope(scopes, token: String) -> Dictionary:
	if not (scopes is Dictionary):
		return {}
	var d: Dictionary = scopes
	if d.has(token) and d[token] is Dictionary:
		return d[token]
	return d


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
		elif s.get("bag_init", false):   # a pre-0.11.0 entry carried the flag explicitly
			st["bag"] = []
			st["bag_init"] = true
		if s.has("last"):
			st["last"] = s["last"]
		out[id] = st
	return out


## Live frames are {scene, container, index}; the save carries {sceneId, containerId, index, nextId?}.
## Each frame is stamped with the id of the child it would run next, so a restore against an EDITED
## bundle re-finds the position by id rather than trusting the raw index (spec 9.8). A frame at its
## container's end has no next child and no stamp.
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
		pending = {"groupId": _pending["group_id"], "options": (_pending["options"] as Array).duplicate(true)}
	# The cursor, PRNG and visits. This flow's properties are the registry's, saved with it.
	return {
		"rngState": _prng.a,
		"visits": _visit_counts.duplicate(true),
		"cursor": {
			"flowEnded": _flow_ended,
			"currentSceneId": _current_scene_id if _current_scene_id != "" else null,
			"stack": _snapshot_stack(),
			"activeSnippetId": _active_snippet["id"] if _active_snippet != null else null,
			"beatIndex": _beat_index,
			"pendingChoice": pending,
			"pendingPromptOwnerId": _pending_prompt_owner if _pending_prompt_owner != "" else null,
			"selectors": _save_selectors(_selectors),
		},
	}


func restore(snap: Dictionary) -> void:
	# The family's shape, or the snake_case flat shape this addon wrote before 0.11.0 (`cursor` absent).
	var legacy := not snap.has("cursor")
	var c: Dictionary = snap if legacy else snap["cursor"]
	# Through to_uint32, not a bare mask: the JS runtime persisted this state SIGNED
	# until it was fixed, so saves in the wild carry a negative number here.
	_prng.a = PatterMulberry32.to_uint32(float(_k(snap, "rngState", "rng_state")))
	_visit_counts = (snap.get("visits", {}) as Dictionary).duplicate(true)
	_started = true
	_flow_ended = bool(_k(c, "flowEnded", "flow_ended"))
	_beat_index = int(_k(c, "beatIndex", "beat_index"))
	var csid = _k(c, "currentSceneId", "current_scene_id")
	_current_scene_id = str(csid) if csid != null else ""
	# Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives siblings
	# inserted / removed / reordered before the cursor); fall back to the raw index when absent or
	# its node drifted out of the bundle (spec 9.8 best-effort).
	_stack = []
	for saved_frame in (c.get("stack", []) as Array):
		var sf: Dictionary = saved_frame
		var f := {"scene": str(_k(sf, "sceneId", "scene")), "container": str(_k(sf, "containerId", "container")), "index": int(sf["index"])}
		var next_id = _k(sf, "nextId", "next_id")
		if next_id != null and str(next_id) != "":
			var children = _children_of(f["container"])
			if children != null:
				var kids: Array = children
				for i in range(kids.size()):
					var child: Dictionary = kids[i]
					if child["id"] == str(next_id):
						f["index"] = i
						break
		_stack.append(f)
	# Register this flow's bags: each claims the values the registry holds for it (loaded by the game,
	# by load_game from the save, or handed back by the engine this one replaces), laid over fresh
	# defaults. The scenes the cursor stands in are registered now; any other scene's bag is claimed
	# on entry. A version 2 snapshot's own "scopes" / "sceneBags" were moved into the registry by
	# load_game before this ran.
	_release_bags(false)
	_mount_local()
	var here := {}
	if _current_scene_id != "":
		here[_current_scene_id] = true
	for f in _stack:
		here[f["scene"]] = true
	for s in here:
		if _host["bundle"]["scenes"].has(s):
			_ensure_scene_bags(s)
	_active_snippet = null
	var asid = _k(c, "activeSnippetId", "active_snippet_id")
	if asid != null and str(asid) != "" and _host["node_index"].has(str(asid)):
		var node: Dictionary = _host["node_index"][str(asid)]
		if node.get("type", "") == "snippet":
			_active_snippet = node
	_selectors = _load_selectors(c.get("selectors", {}))
	# Replay the saved option set VERBATIM: re-deriving would re-evaluate conditions and could change
	# the choice under the player. Options whose nodes drifted out of the bundle are dropped; a choice
	# with no surviving options dissolves (spec 9.8).
	_pending = null
	var saved_options: Array = []
	var group_id := ""
	var pc = c.get("pendingChoice", null)
	if pc is Dictionary:
		saved_options = (pc as Dictionary).get("options", [])
		group_id = str((pc as Dictionary).get("groupId", ""))
	elif legacy:
		saved_options = snap.get("pending_options", [])
		group_id = str(snap.get("pending_group_id", ""))
	if not saved_options.is_empty():
		var options: Array = []
		var by_id: Dictionary = {}
		for o in saved_options:
			if not _host["node_index"].has(o["id"]):
				continue
			by_id[o["id"]] = _host["node_index"][o["id"]]
			options.append((o as Dictionary).duplicate(true))
		if not options.is_empty():
			_pending = {"group_id": group_id, "options": options, "by_id": by_id}

	# A save taken between choose() and the next advance() left a prompt still to be replayed;
	# re-derive it from the chosen option (dropped if that option drifted out of the bundle).
	_pending_prompt_beat = null
	var ppo = _k(c, "pendingPromptOwnerId", "pending_prompt_owner")
	_pending_prompt_owner = str(ppo) if ppo != null else ""
	if _pending_prompt_owner != "" and _host["node_index"].has(_pending_prompt_owner):
		_pending_prompt_beat = _prompt_beat_of(_host["node_index"][_pending_prompt_owner])
	if _pending_prompt_beat == null:
		_pending_prompt_owner = ""
