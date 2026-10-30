# Content errors play through, and are reported: what the corpus cannot see. The corpus pins the
# transcript (a failing condition counts as false, a failing effect is skipped and the rest of its list
# runs); this pins the REPORT. The "on_error" option gets {flow, kind, node, source?, message} for a
# failing condition, a failing effect, a refused read-only @world write and a Best-match part that fails;
# the decision log gets a `diagnostic` entry for each and no `write` entry for a skipped effect. It also
# pins the save rules the corpus cannot express: a bare snapshot with no envelope and a save with no
# flows are refused, and a refused load leaves the engine exactly as it was; and restore_flow's
# refusals (an open id, an open checkpoint, a version it cannot read, a state with no cursor), which
# change nothing.
#
#   godot --headless --path ports/godot --script res://test/test_play_errors.gd
extends SceneTree

var _fails := 0

const StatePanel := preload("res://addons/patterplay/ui/state_panel.gd")


func _n(v: float) -> Dictionary:
	return {"src": str(v), "ast": ["n", v]}


# 10 / @zero: a division by zero, which the evaluator refuses.
const DIV_ZERO := ["bin", "/", ["n", 10], ["sv", "patter", "zero"]]


func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"T_vals": "vals", "T_bad": "bad", "T_ok": "ok", "X": "x", "Y": "y"}},
		"properties": [
			{"name": "zero", "type": "number", "default": 0},
			{"name": "a", "type": "number", "default": 0},
			{"name": "c", "type": "number", "default": 0},
			{"name": "d", "type": "number", "default": 0},
			{"name": "e", "type": "number", "default": 0},
		],
		"scopeRegistry": {"version": 1, "scopes": [
			{"token": "world", "declarations": [
				{"name": "clock", "type": "string", "default": "day", "writable": false},
			]},
		]},
		"scenes": {"s": {"id": "s", "gameId": "s",
			# The scene's own onEntry: an effect that fails here belongs to the scene.
			"onEntry": [
				{"kind": "set", "target": "@e", "value": {"src": "10 / @zero", "ast": DIV_ZERO}},
			],
			"blocks": [{"id": "b", "gameId": "b", "children": [
				{"id": "sn_set", "type": "snippet", "beats": [{"id": "T_vals", "kind": "text"}], "onEnter": [
					{"kind": "set", "target": "@a", "value": _n(1)},
					{"kind": "set", "target": "@c", "value": {"src": "10 / @zero", "ast": DIV_ZERO}},
					{"kind": "set", "target": "@world.clock", "value": {"src": "\"night\"", "ast": ["s", "night"]}},
					{"kind": "set", "target": "@d", "value": _n(1)},
				]},
				{"id": "g_br", "type": "group", "selector": "branch", "children": [
					{"id": "sn_bad", "type": "snippet", "beats": [{"id": "T_bad", "kind": "text"}],
						"condition": {"src": "10 / @zero > 1", "ast": ["bin", ">", DIV_ZERO, ["n", 1]]}},
					{"id": "sn_ok", "type": "snippet", "beats": [{"id": "T_ok", "kind": "text"}]},
				]},
				# Best match: sn_x is eligible (its `or` short-circuits on the first part), and scoring it
				# walks the second part too, which fails: that part scores as false and is reported.
				{"id": "g_bm", "type": "group", "selector": "sequence", "options": {"order": "specificity", "exhaust": "repeat"}, "children": [
					{"id": "sn_x", "type": "snippet", "beats": [{"id": "X", "kind": "text"}],
						"condition": {"src": "@zero == 0 or 10 / @zero > 2", "ast": ["bin", "or",
							["bin", "==", ["sv", "patter", "zero"], ["n", 0]], ["bin", ">", DIV_ZERO, ["n", 2]]]}},
					{"id": "sn_y", "type": "snippet", "beats": [{"id": "Y", "kind": "text"}],
						"condition": {"src": "@a == 1 and @d == 1", "ast": ["bin", "and",
							["bin", "==", ["sv", "patter", "a"], ["n", 1]], ["bin", "==", ["sv", "patter", "d"], ["n", 1]]]}},
				]},
				{"id": "sn_end", "type": "snippet", "jump": {"to": "END"}},
			]}],
		}},
	}


func _initialize() -> void:
	_check_reports(true)
	_check_reports(false)
	_check_default_reporting()
	_check_save_refusals()
	_check_flow_state_refusals()
	_check_dry_choice()
	print("test_play_errors: ALL PASS" if _fails == 0 else "test_play_errors: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


func _play(flow: PatterFlow) -> Array:
	var texts: Array = []
	for i in 50:
		var step: Dictionary = flow.advance()
		if step["type"] == "end":
			break
		texts.append(step.get("text", step["type"]))
	return texts


func _check_reports(log_on: bool) -> void:
	var tag := "[log %s] " % ("on" if log_on else "off")
	var errors: Array = []
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "log": log_on,
		"on_error": func(e: Dictionary) -> void: errors.append(e)})
	var flow := engine.open_flow("main", "s")
	var texts := _play(flow)

	# Played through: the bad branch counted as false, Best match picked the clear winner.
	_expect(texts == ["vals", "ok", "y"], tag + "the story plays through its errors: " + str(texts))
	_expect(engine.get_property("@a") == 1.0 and engine.get_property("@d") == 1.0,
		tag + "the effects either side of the failing ones ran")
	_expect(engine.get_property("@c") == 0.0, tag + "the failing effect wrote nothing")
	_expect(engine.get_property("@world.clock") == "day", tag + "the read-only @world write was refused")

	var want := [
		{"kind": "effect", "node": "s", "source": "10 / @zero"},
		{"kind": "effect", "node": "sn_set", "source": "10 / @zero"},
		{"kind": "effect", "node": "sn_set", "source": "\"night\""},
		{"kind": "condition", "node": "sn_bad", "source": "10 / @zero > 1"},
		{"kind": "best-match", "node": "sn_x", "source": "@zero == 0 or 10 / @zero > 2"},
	]
	_expect(errors.size() == want.size(), tag + "on_error was called once per error: %d calls %s" % [errors.size(), str(errors)])
	for i in mini(errors.size(), want.size()):
		var got: Dictionary = errors[i]
		for k in want[i]:
			_expect(got.get(k) == want[i][k], tag + "error %d %s is %s, got %s" % [i, k, want[i][k], str(got.get(k))])
		_expect(got.get("flow") == "main", tag + "error %d names its flow" % i)
		_expect(str(got.get("message", "")) != "", tag + "error %d carries a message" % i)
		_expect(got.keys().size() == 5, tag + "error %d has exactly flow, kind, node, source, message: %s" % [i, str(got.keys())])
	if errors.size() >= 3:
		_expect(str(errors[2]["message"]).contains("read-only"),
			tag + "the refused @world write says why: " + str(errors[2]["message"]))

	var diags: Array = engine.log().filter(func(e): return e["type"] == "diagnostic")
	var writes: Array = engine.log().filter(func(e): return e["type"] == "write")
	if not log_on:
		_expect(engine.log().is_empty(), tag + "nothing is logged")
		return
	_expect(diags.size() == want.size(), tag + "one diagnostic entry per error: %d" % diags.size())
	for i in mini(diags.size(), want.size()):
		var d: Dictionary = diags[i]
		for k in want[i]:
			_expect(d.get(k) == want[i][k], tag + "diagnostic %d %s is %s, got %s" % [i, k, want[i][k], str(d.get(k))])
		_expect(d.get("message") == errors[i].get("message"), tag + "diagnostic %d carries the error's message" % i)
		_expect(d.get("flow") == "main", tag + "the engine's diagnostic %d names its flow" % i)
	var flow_diags: Array = flow.log().filter(func(e): return e["type"] == "diagnostic")
	_expect(flow_diags.size() == want.size(), tag + "the flow's own log carries the diagnostics too")
	var targets: Array = writes.map(func(e): return e["target"])
	_expect(targets == ["@a", "@d"], tag + "write entries only for the effects that landed: " + str(targets))
	# The state panel's log draws a diagnostic, rather than "(unknown)".
	if not diags.is_empty():
		var line: String = StatePanel._format_log_entry(diags[1])
		_expect(line.contains("diagnostic effect on sn_set (10 / @zero): "), tag + "the state panel draws a diagnostic: " + line)


# Unset, the engine reports through push_warning (not checkable headless) and still plays through.
func _check_default_reporting() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 1})
	var texts := _play(engine.open_flow("main", "s"))
	_expect(texts == ["vals", "ok", "y"], "with no on_error the story still plays through: " + str(texts))


func _check_save_refusals() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 1})
	var flow := engine.open_flow("main", "s")
	var first: Dictionary = flow.advance()
	_expect(first.get("text") == "vals", "the flow starts")
	engine.set_property("@a", 5)
	var good: Dictionary = engine.save_game()

	# A bare snapshot with no envelope: refused, as on every runtime. A bare version 2 one used to load
	# (a .patterstate from before the envelope existed); a bare version 3 one never did.
	var bare_v2: Dictionary = good.duplicate(true)
	bare_v2["version"] = 2
	bare_v2.erase("registry")
	bare_v2["shared"] = {"patter": {"a": 9}}
	_expect(not PatterSave.load_state(engine, bare_v2), "a bare version 2 snapshot with no envelope is refused")
	_untouched(engine, flow, "after a bare version 2 snapshot")
	_expect(not PatterSave.load_state(engine, good), "a bare version 3 snapshot with no envelope is refused")
	_untouched(engine, flow, "after a bare version 3 snapshot")

	# A save with no flows: refused BEFORE anything changes. It used to close every flow and load the
	# registry first, leaving the engine half-loaded.
	var no_flows := {"version": 3, "registry": {"patter": {"a": 9}}}
	_expect(not engine.load_game(no_flows), "a save with no flows is refused")
	_untouched(engine, flow, "after a save with no flows")
	var flows_not_object := {"version": 3, "registry": {"patter": {"a": 9}}, "flows": []}
	_expect(not engine.load_game(flows_not_object), "a save whose flows is not an object is refused")
	_untouched(engine, flow, "after a save whose flows is not an object")
	_expect(not PatterSave.load_state(engine, {"schema": PatterSave.SCHEMA, "save": no_flows}),
		"an envelope holding a save with no flows is refused")
	_untouched(engine, flow, "after an envelope with no flows")

	# A version that is not exactly 3 or 4.
	var bad_version: Dictionary = good.duplicate(true)
	bad_version["version"] = 3.9
	_expect(not engine.load_game(bad_version), "save version 3.9 is refused")
	_untouched(engine, flow, "after version 3.9")

	# The envelope still loads; a version 2 save inside one no longer does (1.0 reads versions 3 and 4).
	_expect(PatterSave.load_state(engine, {"schema": PatterSave.SCHEMA, "save": good}), "the envelope loads")
	var next: Dictionary = engine.get_flow("main").advance()
	_expect(next.get("text") == "ok", "the loaded flow carries on: " + str(next))
	_expect(not PatterSave.load_state(engine, {"schema": PatterSave.SCHEMA, "save": bare_v2}),
		"a version 2 save inside the envelope is refused")
	_expect(engine.get_property("@a") == 5.0, "and the values stay as they were: " + str(engine.get_property("@a")))


## restore_flow refuses an id that is open, an open checkpoint, a version it cannot read, and a state
## with no cursor, and a refusal changes nothing. capture_flow only reads, so a checkpoint doesn't
## stop it.
func _check_flow_state_refusals() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 1})
	var flow := engine.open_flow("main", "s")
	_expect(flow.advance().get("text") == "vals", "the flow starts")
	engine.set_property("@a", 5)
	var state: Dictionary = engine.capture_flow("main")
	_expect(not state.is_empty() and int(state.get("version", 0)) == PatterEngine.SAVE_VERSION, "a flow is captured: " + str(state.keys()))
	_expect(engine.capture_flow("nobody").is_empty(), "a flow that isn't open has nothing to capture")
	var before: Dictionary = engine.save_game()

	_expect(engine.restore_flow("main", state) == null, "restore_flow is refused over an id that is open")
	_untouched(engine, flow, "after a restore over its id")
	_expect(_same(engine.save_game(), before), "a restore over an open id changes nothing")

	var stale: Dictionary = state.duplicate(true)
	stale["version"] = 2
	_expect(engine.restore_flow("spare", stale) == null, "flow state version 2 is refused")
	_expect(engine.get_flow("spare") == null and _same(engine.save_game(), before), "a refused version changes nothing")

	var cp := engine.checkpoint()
	_expect(engine.restore_flow("spare", state) == null, "restore_flow is refused while a checkpoint is open")
	_expect(engine.in_checkpoint() and engine.get_flow("spare") == null, "a refused restore leaves the checkpoint open and opens nothing")
	var inside: Dictionary = engine.capture_flow("main")
	_expect(_same(inside, state), "capture_flow is allowed while a checkpoint is open, and only reads")
	engine.commit(cp)

	# A state that won't restore (here, no cursor) is refused before anything changes, so it leaves
	# nothing behind: no flow under the id, and no values in the registry.
	engine.close_flow("main")
	var closed: Dictionary = engine.save_game()
	var broken: Dictionary = inside.duplicate(true)
	broken["cursor"] = null
	_expect(engine.restore_flow("main", broken) == null, "a state with no cursor is refused")
	_expect(engine.get_flow("main") == null and _same(engine.save_game(), closed), "a state that won't restore leaves nothing behind")

	# The same id, once it is free.
	var back := engine.restore_flow("main", inside)
	_expect(back != null and engine.get_flow("main") == back, "a closed flow's id takes a restore")
	_expect(back != null and back.advance().get("text") == "ok", "and the restored flow carries on")


## Two plain-data Dictionaries, compared through JSON (key order aside, as a save is read).
static func _same(a: Dictionary, b: Dictionary) -> bool:
	return JSON.parse_string(JSON.stringify(a)) == JSON.parse_string(JSON.stringify(b))


## The dry-choice hub: one option that plays once and comes back, then `after` in the same block.
func _dry_bundle(after: Array) -> Dictionary:
	var children: Array = [{"id": "g", "type": "group", "selector": "choice", "children": [
		{"id": "o_ask", "type": "group", "prompt": {"id": "P_ask", "kind": "text"}, "children": [
			{"id": "sn_ans", "type": "snippet", "beats": [{"id": "ANS", "kind": "text"}], "jump": {"to": "hub"}},
		]},
	]}]
	children.append_array(after)
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"P_ask": "Ask", "ANS": "answered", "ON": "carried on"}},
		"scenes": {"s": {"id": "s", "gameId": "s", "type": "scene", "name": "S",
			"blocks": [{"id": "hub", "type": "block", "name": "Hub", "children": children}]}},
	}


## Open the hub, take its one option, and play it: the next advance finds the choice dry.
func _dry_play(after: Array, errors: Array) -> PatterEngine:
	var engine := PatterEngine.new(_dry_bundle(after), {"seed": 1,
		"on_error": func(e: Dictionary) -> void: errors.append(e)})
	var flow := engine.open_flow("f", "s")
	flow.advance()
	flow.choose("o_ask")
	flow.advance()
	return engine


func _kinds(errors: Array) -> Array:
	var out: Array = []
	for e in errors:
		out.append(e["kind"])
	return out


## A choice that runs dry and then ends the flow: reported once through on_error (kind "dry-choice"), and
## the end step's reason says "ran-dry". The corpus pins the transcript and the report; this pins what it
## cannot: the message, rollback, restore's rule, reset, a host goto to a scene, and a closed flow.
func _check_dry_choice() -> void:
	var errors: Array = []
	var engine := _dry_play([], errors)
	var flow := engine.get_flow("f")
	var end := flow.advance()
	_expect(end == {"type": "end", "reason": "ran-dry"}, "dry: the end says it ran dry: " + str(end))
	_expect(errors.size() == 1 and errors[0]["kind"] == "dry-choice" and errors[0]["node"] == "g"
		and errors[0]["flow"] == "f" and str(errors[0]["message"]).contains("'g' ran dry"),
		"dry: reported once, naming the group and the flow: " + str(errors))
	_expect(flow.advance() == {"type": "end", "reason": "ran-dry"} and errors.size() == 1,
		"dry: asked again, the same end and no second report")
	var snap := flow.snapshot()
	_expect(snap["cursor"].get("ranDry") == "g", "dry: the save cursor carries ranDry")

	# A load keeps the reason and doesn't report it again; restore honours ranDry only on an ended flow.
	var save := engine.save_game()
	var errors2: Array = []
	var again := PatterEngine.new(_dry_bundle([]), {"seed": 1,
		"on_error": func(e: Dictionary) -> void: errors2.append(e)})
	_expect(again.load_game(JSON.parse_string(JSON.stringify(save))), "dry: the save loads")
	_expect(again.get_flow("f").advance() == {"type": "end", "reason": "ran-dry"} and errors2.is_empty(),
		"dry: a loaded flow ends the same way, unreported: " + str(errors2))
	var live := PatterEngine.new(_dry_bundle([]), {"seed": 1}).open_flow("f", "s")
	var not_ended := live.snapshot()
	not_ended["cursor"]["ranDry"] = "g"
	live.restore(not_ended)
	_expect(live.advance()["type"] == "choice", "dry: a stray ranDry on a flow that hasn't ended is ignored")

	# A checkpoint rolled back puts the dry choice back, so the end is reported again when replayed.
	errors.clear()
	var e3 := _dry_play([], errors)
	var cp := e3.checkpoint()
	_expect(e3.get_flow("f").advance()["reason"] == "ran-dry", "dry: ends ran-dry inside a checkpoint")
	e3.rollback(cp)
	_expect(e3.get_flow("f").snapshot()["cursor"].get("ranDry") == null, "dry: rollback clears ranDry")
	_expect(e3.get_flow("f").advance()["reason"] == "ran-dry" and _kinds(errors) == ["dry-choice", "dry-choice"],
		"dry: after rollback the end is reported again: " + str(_kinds(errors)))

	# An END straight after the dry choice still counts.
	errors.clear()
	var e4 := _dry_play([{"id": "sn_end", "type": "snippet", "jump": {"to": "END"}}], errors)
	_expect(e4.get_flow("f").advance() == {"type": "end", "reason": "ran-dry"} and _kinds(errors) == ["dry-choice"],
		"dry: an END straight after it still ran dry")

	# Play that carries on past it is the gather idiom: silent, and a plain end.
	errors.clear()
	var e5 := _dry_play([{"id": "sn_on", "type": "snippet", "beats": [{"id": "ON", "kind": "text"}]}], errors)
	var f5 := e5.get_flow("f")
	_expect(f5.advance().get("text") == "carried on", "dry: play carries on past it")
	_expect(f5.advance() == {"type": "end", "reason": "ended"} and errors.is_empty(),
		"dry: carried on, the end is plain and nothing is reported: " + str(errors))
	_expect(not f5.snapshot()["cursor"].has("ranDry"), "dry: ranDry is written only when set")

	# The host's goto("END") is a plain end; goto to a scene revives it (dry again, reported again); reset clears.
	errors.clear()
	var e6 := _dry_play([], errors)
	var f6 := e6.get_flow("f")
	f6.advance()
	f6.goto("END")
	_expect(f6.advance() == {"type": "end", "reason": "ended"}, "dry: the host's goto(\"END\") is a plain end")
	errors.clear()
	var e7 := _dry_play([], errors)
	var f7 := e7.get_flow("f")
	f7.advance()
	f7.goto("s")
	_expect(f7.advance()["reason"] == "ran-dry" and _kinds(errors) == ["dry-choice", "dry-choice"],
		"dry: goto a scene revives it, and it runs dry again: " + str(_kinds(errors)))
	f7.reset("s")
	_expect(f7.advance()["type"] == "choice", "dry: reset begins again")
	e7.close_flow("f")
	_expect(f7.advance() == {"type": "end", "reason": "ended"}, "dry: a closed flow's advance is a plain end")


func _untouched(engine: PatterEngine, flow: PatterFlow, when: String) -> void:
	_expect(engine.get_flow("main") == flow, "the flow is still the open one " + when)
	_expect(not flow.is_closed(), "the flow is not closed " + when)
	_expect(engine.get_property("@a") == 5.0, "@a keeps its value " + when + ": " + str(engine.get_property("@a")))
	var snap: Dictionary = flow.snapshot()
	# Its one beat delivered, so the cursor names no next beat.
	_expect(snap["cursor"]["activeSnippetId"] == "sn_set" and not snap["cursor"].has("beatId"),
		"the flow's cursor did not move " + when)


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: " + what)
