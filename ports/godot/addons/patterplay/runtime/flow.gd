# PatterFlow - one playable flow: its execution cursor (a continuation stack of block / run-group
# positions), the not-shared half of @patter / @scene, a serialisable PRNG, per-flow visit + selector
# state. Port of engine.ts's Flow (via the corpus-verified C#/C++ ports). advance() returns a normalised
# step Dictionary (line / text / gameEvent / choice / end), the same shape the conformance transcript pins.
class_name PatterFlow
extends RefCounted

var id: String
var _host: Dictionary
var _local   # PatterPropertyBag: this flow's not-shared @patter half
var _scene_bags: Dictionary = {}
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
	_local = _fresh_local()
	_eval_ctx = {
		"scopes": {
			"patter": func(n): return _patter_get(n),
			"scene": func(n): return _scene_get(n),
		},
		"next_random": func(): return _rng(),
		"visits": func(nid): return _visit_counts.get(nid, 0),
		"patter_visits": func(nid): return _host["shared_visits"].get(nid, 0),
		# The quality channel: a property's stage ladder, from wherever the declaration lives -
		# @patter decls, the CURRENT scene's decls (they move with the flow), or a host scope.
		"qualities": func(scope, name): return _stages_for(scope, name),
	}
	# Declared host scopes (@world): bound by the embedder or self-backed by the engine. Registering
	# them is what stops "@world.x" reading as a graceful false.
	for token in _host.get("host_scopes", {}).keys():
		var scope: Dictionary = _host["host_scopes"][token]
		_eval_ctx["scopes"][token] = scope["get"]


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
# shared state. Closing makes that stale reference inert. Terminal: never revived.
func close() -> void:
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
	_scene_bags = {}
	_local = _fresh_local()
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
	var sp := PatterBundle.split_ref(ref, _host["host_tokens"])
	if sp[0] == "patter":
		return _patter_get(sp[1])
	if sp[0] == "scene":
		return _scene_get(sp[1])
	if _host["host_scopes"].has(sp[0]):
		return _host["host_scopes"][sp[0]]["get"].call(sp[1])
	return null


func set_property(ref: String, value) -> void:
	var sp := PatterBundle.split_ref(ref, _host["host_tokens"])
	if sp[0] == "patter":
		_patter_set(sp[1], value)
	elif sp[0] == "scene":
		if _current_scene_id == "":
			push_error("'%s': the flow has not entered a scene yet" % ref)
			return
		_scene_set(sp[1], value)
	elif _host["host_scopes"].has(sp[0]):
		_host["host_scopes"][sp[0]]["set"].call(sp[1], value)


# -- scope resolvers -----------------------------------------------------------

func _patter_get(n: String):
	if _host["patter_shared_names"].has(n):
		return _host["shared_patter"].get_value(n)
	return _local.get_value(n)


func _patter_set(n: String, v) -> void:
	if _host["patter_shared_names"].has(n):
		_host["shared_patter"].set_value(n, v)
	else:
		_local.set_value(n, v)


func _scene_bag_for(n: String):
	if _current_scene_id == "":
		return null
	var shared: bool = _host["scene_shared_names"].get(_current_scene_id, {}).has(n)
	if shared:
		return _host["stage_bags"].get(_current_scene_id)
	return _scene_bags.get(_current_scene_id)


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
	var ctx := _eval_ctx
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
		set_property(e["target"], v)
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
	return PatterExpr.evaluate(expr["ast"], _eval_ctx, _dialect)


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
	# The bag's constructor IS the loop this replaced: lowercase the name, seed the declared
	# default else the type's, and deep-copy it so two bags seeded from one declaration set
	# never share a mutable flags array.
	var props: Array = scene.get("sceneProps", [])
	if not _scene_bags.has(scene["id"]):
		_scene_bags[scene["id"]] = PatterPropertyBag.new(_props_for(props, shared, false))
	if not _host["stage_bags"].has(scene["id"]):
		_host["stage_bags"][scene["id"]] = PatterPropertyBag.new(_props_for(props, shared, true))
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


# Bags -> the flat name/value Dictionaries the save format has always carried. The bags
# are a runtime detail; the envelope is a contract with every save already on disk.
static func _save_bags(bags: Dictionary) -> Dictionary:
	var out := {}
	for sid in bags:
		out[sid] = bags[sid].save()
	return out


# The reverse: seed each bag from the BUNDLE's declarations, then lay the saved values
# over. A property the save predates keeps its declared default rather than vanishing,
# and one the bundle has since dropped lands as a stray - the old duplicate() did the
# second but not the first.
static func _load_bags(host: Dictionary, saved: Dictionary, want_shared: bool) -> Dictionary:
	var out := {}
	var scenes: Dictionary = host["bundle"].get("scenes", {})
	for sid in saved:
		var shared: Dictionary = host["scene_shared_names"].get(sid, {})
		var props: Array = scenes.get(sid, {}).get("sceneProps", [])
		var bag = PatterPropertyBag.new(_props_for(props, shared, want_shared))
		bag.load(saved[sid])
		out[sid] = bag
	return out


func _fresh_local():
	# This flow's NOT-shared @patter half, in a bag for the same reasons as the shared one.
	return PatterPropertyBag.new(_host["patter_local_decls"], {"path_prefix": "@patter."})


# -- save / restore ------------------------------------------------------------

# The stack, each frame stamped with the id of the child it would run next (mirrors the JS
# runtime's StackFrame.nextId): a frame saved at its container's end gets no stamp.
# -- the save shape --------------------------------------------------------------
#
# A save is written in the FAMILY's shape: `patter/save@0`, the JS reference's, documented in
# @patterkit/model and design/patter-schema.md 9. camelCase literal keys, the execution position
# under `cursor`, a pending choice as `{groupId, options}`, scopes two-level (`{"patter": {...}}`),
# selector cursors with every key optional. Every Patterplay runtime writes and reads exactly this, so
# a save crosses engines. Until 0.11.0 this addon wrote snake_case keys with the cursor fields flat,
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
	return {
		"scopes": {"patter": _local.save()},
		"sceneBags": _save_bags(_scene_bags),
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
	var scene_bags = _k(snap, "sceneBags", "scene_bags")
	_scene_bags = _load_bags(_host, scene_bags if scene_bags is Dictionary else {}, false)
	_local = _fresh_local()
	_local.load(_unwrap_scope(snap.get("scopes", {}), "patter"))
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
