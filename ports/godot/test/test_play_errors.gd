# Content errors play through, and are reported: what the corpus cannot see. The corpus pins the
# transcript (a failing condition counts as false, a failing effect is skipped and the rest of its list
# runs); this pins the REPORT. The "on_error" option gets {flow, kind, node, source?, message} for a
# failing condition, a failing effect, a refused read-only @world write and a Best-match part that fails;
# the decision log gets a `diagnostic` entry for each and no `write` entry for a skipped effect. It also
# pins the save rules the corpus cannot express: a bare snapshot with no envelope and a save with no
# flows are refused, and a refused load leaves the engine exactly as it was.
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

	# A version that is not exactly 2 or 3.
	var bad_version: Dictionary = good.duplicate(true)
	bad_version["version"] = 3.9
	_expect(not engine.load_game(bad_version), "save version 3.9 is refused")
	_untouched(engine, flow, "after version 3.9")

	# The envelope still loads, and so does a version 2 save inside one.
	_expect(PatterSave.load_state(engine, {"schema": PatterSave.SCHEMA, "save": good}), "the envelope loads")
	var next: Dictionary = engine.get_flow("main").advance()
	_expect(next.get("text") == "ok", "the loaded flow carries on: " + str(next))
	_expect(PatterSave.load_state(engine, {"schema": PatterSave.SCHEMA, "save": bare_v2}),
		"a version 2 save inside the envelope still loads")
	_expect(engine.get_property("@a") == 9.0, "the version 2 save's values reach the registry: " + str(engine.get_property("@a")))


func _untouched(engine: PatterEngine, flow: PatterFlow, when: String) -> void:
	_expect(engine.get_flow("main") == flow, "the flow is still the open one " + when)
	_expect(not flow.is_closed(), "the flow is not closed " + when)
	_expect(engine.get_property("@a") == 5.0, "@a keeps its value " + when + ": " + str(engine.get_property("@a")))
	var snap: Dictionary = flow.snapshot()
	_expect(snap["cursor"]["activeSnippetId"] == "sn_set" and int(snap["cursor"]["beatIndex"]) == 1,
		"the flow's cursor did not move " + when)


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: " + what)
