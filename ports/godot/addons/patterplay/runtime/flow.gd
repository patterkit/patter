# PatterFlow - one playable flow: its execution cursor (a continuation stack of block / run-group
# positions), the not-shared half of @patter / @scene, a serialisable PRNG, per-flow visit + selector
# state. Port of engine.ts's Flow (via the corpus-verified C#/C++ ports). advance() returns a normalised
# step Dictionary (line / text / gameEvent / choice / end), the same shape the conformance transcript pins.
class_name PatterFlow
extends RefCounted

var id: String
var _host: Dictionary
var _local: Dictionary = {}
var _scene_bags: Dictionary = {}
var _prng := Mulberry32.new(0)  # the seeded PRNG; its `a` is the saved rng_state

var _started := false
var _flow_ended := false
# Closed by the engine (see close()). Terminal, and distinct from _flow_ended: an ENDED flow is
# merely out of content and goto() revives it; a CLOSED one is finished for good.
var _closed := false
var _current_scene_id := ""           # "" = none
var _stack: Array = []                # of { "scene":, "container":, "index": }
var _active_snippet = null            # node Dictionary or null
var _beat_index := 0
var _pending = null                   # { "group_id":, "options":[normalised], "by_id":{id:node} } or null
var _pending_prompt_beat = null       # beat Dictionary or null
var _pending_prompt_owner: String = "" # chosen option owning _pending_prompt_beat, re-derivable across a save in the choose->advance window
var _selectors: Dictionary = {}
var _visit_counts: Dictionary = {}
var _eval_ctx: Dictionary


func _init(host: Dictionary, seed_value: int) -> void:
	_host = host
	_prng = Mulberry32.new(seed_value)
	_local = _fresh_local()
	_eval_ctx = {
		"scopes": {
			"patter": func(n): return _patter_get(n),
			"scene": func(n): return _scene_get(n),
		},
		"next_random": func(): return _rng(),
		"visits": func(nid): return _visit_counts.get(nid, 0),
		"patter_visits": func(nid): return _host["shared_visits"].get(nid, 0),
	}


func current_scene() -> String:
	return _current_scene_id


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
	_pending = null
	_pending_prompt_beat = _prompt_beat_of(node) if _host["replay_prompt_on_choose"] else null
	_pending_prompt_owner = node["id"] if _pending_prompt_beat != null else ""
	_enter_child(node)


func get_property(ref: String):
	var sp := PatterBundle.split_ref(ref)
	if sp[0] == "patter":
		return _patter_get(sp[1])
	if sp[0] == "scene":
		return _scene_get(sp[1])
	return null


func set_property(ref: String, value) -> void:
	var sp := PatterBundle.split_ref(ref)
	if sp[0] == "patter":
		_patter_set(sp[1], value)
	elif sp[0] == "scene":
		if _current_scene_id == "":
			push_error("'%s': the flow has not entered a scene yet" % ref)
			return
		_scene_set(sp[1], value)


# -- scope resolvers -----------------------------------------------------------

func _patter_get(n: String):
	if _host["patter_shared_names"].has(n):
		return _host["shared_patter"].get(n)
	return _local.get(n)


func _patter_set(n: String, v) -> void:
	if _host["patter_shared_names"].has(n):
		_host["shared_patter"][n] = v
	else:
		_local[n] = v


func _scene_bag_for(n: String):
	if _current_scene_id == "":
		return null
	var shared: bool = _host["scene_shared_names"].get(_current_scene_id, {}).has(n)
	if shared:
		return _host["stage_bags"].get(_current_scene_id)
	return _scene_bags.get(_current_scene_id)


func _scene_get(n: String):
	var bag = _scene_bag_for(n)
	return bag.get(n) if bag != null else null


func _scene_set(n: String, v) -> void:
	var bag = _scene_bag_for(n)
	if bag != null:
		bag[n] = v


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
		while frame["index"] < children.size() and not _eligible(children[frame["index"]]):
			frame["index"] += 1
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
		_pending = {"group_id": group["id"], "options": options, "by_id": by_id}
		return
	for f in fallbacks:
		if _eligible(f):
			_enter_child(f)
			return


# -- jumps ---------------------------------------------------------------------

func _resolve_jump(jump) -> void:
	if jump == null:
		return
	_enter_target(jump["to"], "call" if jump.get("mode", "") == "call" else "jump")


func _enter_target(to: String, mode: String) -> void:
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
	for c in group.get("children", []):
		if _eligible(c):
			eligible.append(c)
	if eligible.is_empty():
		return null
	var st := _selector_state_for(group)
	var selector: String = group.get("selector", "")
	if selector == "branch":
		return eligible[0]
	if selector == "sequence":
		var opts: Dictionary = group.get("options", {})
		var order: String = opts.get("order", "sequential")
		var exhaust: String = opts.get("exhaust", "once")
		if order == "shuffle":
			return _pick_shuffle(eligible, exhaust, st)
		if order == "specificity":
			return _pick_specificity(eligible, exhaust, st)
		return _pick_sequential(eligible, exhaust, st)
	return null


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
	return _matched_spec(node["condition"]["ast"], _eval_ctx, true)


# matched-specificity: how many atomic constraints are actively holding this condition TRUE against the
# live state, walked with a De-Morgan polarity flag (parity contract, mirrors the JS reference).
# Static + ctx-parameterised so the conformance runner can score a bare AST against injected scopes.
static func _matched_spec(node: Array, ctx: Dictionary, want: bool) -> int:
	var tag = node[0]
	if tag == "bin" and (node[1] == "and" or node[1] == "or"):
		var behave_as_and: bool = (node[1] == "and") == want # De Morgan under negation
		var l := _matched_spec(node[2], ctx, want)
		var r := _matched_spec(node[3], ctx, want)
		if behave_as_and:
			return (l + r) if (l > 0 and r > 0) else 0
		return l if l > r else r
	if tag == "u" and node[1] == "not":
		return _matched_spec(node[2], ctx, not want) # flip polarity
	if tag == "call" and node[1] == "check_flags":
		var operands := node.size() - 3 # ["call","check_flags",source,fd...]
		if operands < 1:
			operands = 1
		var hit := PatterValues.truthy(PatterExpr.evaluate(node, ctx))
		if want:
			return operands if hit else 0
		return 0 if hit else 1
	# Atom: its truth matching the wanted polarity contributes one constraint.
	return 1 if (PatterValues.truthy(PatterExpr.evaluate(node, ctx)) == want) else 0


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
		set_property(e["target"], _eval_expr(e["value"]))


func _eligible(node: Dictionary) -> bool:
	if not node.has("condition"):
		return true
	return PatterValues.truthy(_eval_expr(node["condition"]))


func _eval_expr(expr: Dictionary):
	return PatterExpr.evaluate(expr["ast"], _eval_ctx)


func _enter(nid: String) -> void:
	_visit_counts[nid] = _visit_counts.get(nid, 0) + 1
	_host["shared_visits"][nid] = _host["shared_visits"].get(nid, 0) + 1


func _rng() -> float:
	var custom = _host.get("custom_rng")
	if custom != null:
		return custom.call()
	return _prng.next()  # the same mixing as Mulberry32.next(), no longer duplicated inline


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
	if not _scene_bags.has(scene["id"]):
		var flow_bag := {}
		for decl in scene.get("sceneProps", []):
			var fnm: String = str(decl["name"]).to_lower()
			if not shared.has(fnm):
				flow_bag[fnm] = PatterBundle.prop_default(decl)
		_scene_bags[scene["id"]] = flow_bag
	if not _host["stage_bags"].has(scene["id"]):
		var stage_bag := {}
		for decl in scene.get("sceneProps", []):
			var snm: String = str(decl["name"]).to_lower()
			if shared.has(snm):
				stage_bag[snm] = PatterBundle.prop_default(decl)
		_host["stage_bags"][scene["id"]] = stage_bag
	for decl in scene.get("sceneProps", []):
		if not decl.get("temporary", false):
			continue
		var tnm: String = str(decl["name"]).to_lower()
		var target_bag = _host["stage_bags"][scene["id"]] if shared.has(tnm) else _scene_bags[scene["id"]]
		target_bag[tnm] = PatterBundle.prop_default(decl)


func _fresh_local() -> Dictionary:
	var d := {}
	for decl in _host["patter_local_decls"]:
		d[str(decl["name"]).to_lower()] = PatterBundle.prop_default(decl)
	return d


# -- save / restore ------------------------------------------------------------

# The stack, each frame stamped with the id of the child it would run next (mirrors the JS
# runtime's StackFrame.nextId): a frame saved at its container's end gets no stamp.
func _snapshot_stack() -> Array:
	var out: Array = []
	for f in _stack:
		var frame: Dictionary = f.duplicate(true)
		var children = _children_of(f["container"])
		if children == null:
			out.append(frame)
			continue
		var kids: Array = children
		var idx: int = int(f["index"])
		if idx < kids.size():
			var child: Dictionary = kids[idx]
			frame["next_id"] = child["id"]
		out.append(frame)
	return out


func snapshot() -> Dictionary:
	return {
		"scopes": _local.duplicate(true),
		"scene_bags": _scene_bags.duplicate(true),
		"rng_state": _prng.a,
		"visits": _visit_counts.duplicate(true),
		"flow_ended": _flow_ended,
		"current_scene_id": _current_scene_id,
		# Stamp each frame with the id of the child it would run next ("next_id"), so a restore
		# against an EDITED bundle re-finds the position by id, not the raw index (spec 9.8).
		"stack": _snapshot_stack(),
		"active_snippet_id": _active_snippet["id"] if _active_snippet != null else "",
		"beat_index": _beat_index,
		"pending_group_id": _pending["group_id"] if _pending != null else "",
		"pending_options": (_pending["options"] as Array).duplicate(true) if _pending != null else [],
		"pending_prompt_owner": _pending_prompt_owner,
		"selectors": _selectors.duplicate(true),
	}


func restore(snap: Dictionary) -> void:
	_prng.a = int(snap["rng_state"]) & 0xffffffff  # int() survives a JSON save/load round-trip
	_visit_counts = (snap["visits"] as Dictionary).duplicate(true)
	_started = true
	_flow_ended = snap["flow_ended"]
	_beat_index = int(snap["beat_index"])
	_current_scene_id = snap["current_scene_id"]
	# Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives siblings
	# inserted / removed / reordered before the cursor); fall back to the raw index when absent or
	# its node drifted out of the bundle (spec 9.8 best-effort).
	_stack = (snap["stack"] as Array).duplicate(true)
	for f in _stack:  # JSON save/load turns the cursor index into a float; it must stay an int to index children
		f["index"] = int(f["index"])
		var next_id: String = f.get("next_id", "")
		f.erase("next_id")  # live frames never carry it
		if next_id != "":
			var children = _children_of(f["container"])
			if children != null:
				var kids: Array = children
				for i in range(kids.size()):
					var child: Dictionary = kids[i]
					if child["id"] == next_id:
						f["index"] = i
						break
	_scene_bags = (snap["scene_bags"] as Dictionary).duplicate(true)
	_local = _fresh_local()
	for k in (snap["scopes"] as Dictionary).keys():
		_local[k] = snap["scopes"][k]
	_active_snippet = null
	var asid: String = snap["active_snippet_id"]
	if asid != "" and _host["node_index"].has(asid):
		var node: Dictionary = _host["node_index"][asid]
		if node.get("type", "") == "snippet":
			_active_snippet = node
	_selectors = (snap["selectors"] as Dictionary).duplicate(true)
	_pending = null
	var saved_options: Array = snap["pending_options"]
	if not saved_options.is_empty():
		var options: Array = []
		var by_id: Dictionary = {}
		for o in saved_options:
			if not _host["node_index"].has(o["id"]):
				continue
			by_id[o["id"]] = _host["node_index"][o["id"]]
			options.append(o.duplicate(true))
		if not options.is_empty():
			_pending = {"group_id": snap["pending_group_id"], "options": options, "by_id": by_id}

	# A save taken between choose() and the next advance() left a prompt still to be replayed;
	# re-derive it from the chosen option (dropped if that option drifted out of the bundle).
	_pending_prompt_beat = null
	_pending_prompt_owner = snap.get("pending_prompt_owner", "")
	if _pending_prompt_owner != "" and _host["node_index"].has(_pending_prompt_owner):
		_pending_prompt_beat = _prompt_beat_of(_host["node_index"][_pending_prompt_owner])
	if _pending_prompt_beat == null:
		_pending_prompt_owner = ""
