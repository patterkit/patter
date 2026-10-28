# The runtime foundations before 1.0, where GDScript differs from the reference because it can't throw,
# and where the corpus can't look:
#   1. unknown option keys are reported ("setup", flow ""), the retired "world" key with its own message,
#      at the END of construction, in order: option keys, then the locale, then each host scope
#   2. set_property (engine and flow) RETURNS the refusal ("" when written), and a refused write
#      changes nothing
#   3. advance() and choose() keep their refusal for last_error(), cleared by the next success
#
#   godot --headless --path ports/godot --script res://test/test_runtime_foundations.gd
extends SceneTree

var _fails := 0


func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en", "fr"]},
		"strings": {"en": {"C_a": "Ask", "T_a": "asked", "T": "hello"}, "fr": {"C_a": "Demander", "T_a": "demande", "T": "salut"}},
		"properties": [
			{"name": "gold", "type": "number", "default": 0, "shared": true},
			{"name": "mood", "type": "enum", "values": ["calm", "tense"], "default": "", "shared": true},
		],
		"scopeRegistry": {"version": 1, "scopes": [{"token": "world", "declarations": [{"name": "alarm", "type": "boolean", "default": false}]}]},
		"scenes": {"s": {"id": "s", "gameId": "s",
			"sceneProps": [{"name": "count", "type": "number", "default": 0, "shared": false}],
			"blocks": [{"id": "b", "gameId": "b", "children": [
				{"id": "intro", "type": "snippet", "beats": [{"id": "T", "kind": "text"}]},
				{"id": "g", "type": "group", "selector": "choice", "children": [
					{"id": "a", "type": "group", "prompt": {"id": "C_a", "kind": "text"}, "children": [
						{"id": "a_c", "type": "snippet", "beats": [{"id": "T_a", "kind": "text"}], "jump": {"to": "END"}}]},
				]},
			]}]}},
	}


func _initialize() -> void:
	_check_setup_reports()
	_check_refused_hot_swap()
	_check_missing_start()
	_check_set_property()
	_check_last_error()
	print("test_runtime_foundations: ALL PASS" if _fails == 0 else "test_runtime_foundations: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


func _check_setup_reports() -> void:
	var errors: Array = []
	var engine := PatterEngine.new(_bundle(), {
		"seeed": 1,
		"world": {"get": func(_n): return null},
		"locale": "FR",
		"host_scopes": {"World": {"get": func(_n): return null, "set": func(_n, _v): pass}},
		"on_error": func(e: Dictionary) -> void: errors.append(e),
		"log": true,
	})
	var got: Array = errors.map(func(e): return [e["kind"], e["node"], e["flow"]])
	_expect(got == [["setup", "seeed", ""], ["setup", "world", ""], ["setup", "FR", ""], ["setup", "World", ""]],
		"construction reports option keys, then the locale, then each host scope: " + str(got))
	_expect(errors.size() == 4 and str(errors[1]["message"]).contains("has gone") and str(errors[1]["message"]).contains("host_scopes"),
		"the retired \"world\" key says how to bind it now: " + str(errors[1].get("message") if errors.size() > 1 else ""))
	_expect(errors.size() == 4 and str(errors[3]["message"]).contains("\"world\""),
		"a near-miss host scope names the declared spelling: " + str(errors[3].get("message") if errors.size() > 3 else ""))
	_expect(engine.locale() == "fr", "the locale in use is the bundle's spelling: " + engine.locale())
	var locales := engine.locales()
	(locales["included"] as Array).append("de")
	_expect(engine.locales()["included"] == ["en", "fr"], "locales() hands out a copy: " + str(engine.locales()))
	var diags: Array = engine.log().filter(func(e): return e["type"] == "diagnostic")
	_expect(diags.size() == 4 and diags[0]["kind"] == "setup" and diags[0]["flow"] == "",
		"each report is in the decision log too: " + str(diags))

	errors.clear()
	PatterEngine.new(_bundle(), {"on_error": func(e: Dictionary) -> void: errors.append(e)})
	_expect(errors.is_empty(), "known options report nothing: " + str(errors))


# A hot swap whose load is refused reports set-up once (from the replacement), not again from the engine it
# falls back on. The new bundle names another engine's scope that nothing registered, so the load is refused.
func _check_refused_hot_swap() -> void:
	var nodes: Array = []
	var engine := PatterEngine.new(_bundle(), {"locale": "en-GB", "on_error": func(e: Dictionary) -> void:
		if e["kind"] == "setup":
			nodes.append(e["node"])})
	engine.open_flow("main", "s")
	engine.hot_swap(_bundle())
	_expect(nodes == ["en-GB", "en-GB"], "a hot swap reports the locale again: " + str(nodes))
	nodes.clear()
	engine = PatterEngine.new(_bundle(), {"locale": "en-GB", "on_error": func(e: Dictionary) -> void:
		if e["kind"] == "setup":
			nodes.append(e["node"])})
	engine.open_flow("main", "s")
	var refusing := _bundle()
	refusing["externalScopes"] = ["quest"]
	var fallback := engine.hot_swap(refusing)
	_expect(nodes == ["en-GB", "en-GB"], "a refused-load hot swap reports the locale once: " + str(nodes))
	# The fallback's own hot swap is an ordinary one, which reports again.
	nodes.clear()
	fallback.hot_swap(_bundle())
	_expect(nodes == ["en-GB"], "the fallback's own hot swap reports again: " + str(nodes))


# A start the bundle doesn't have (only a hand-edited bundle can) is passed over.
func _check_missing_start() -> void:
	var bundle := _bundle()
	bundle["start"] = {"scene": "gone"}
	var flow := PatterEngine.new(bundle, {}).open_flow("main")
	_expect(flow.advance().get("text") == "hello", "a start scene the bundle doesn't have starts at the first scene")
	bundle = _bundle()
	bundle["start"] = {"scene": "s", "block": "gone"}
	flow = PatterEngine.new(bundle, {}).open_flow("main")
	_expect(flow.advance().get("text") == "hello", "a start block the scene doesn't have starts at its first block")


func _check_set_property() -> void:
	var engine := PatterEngine.new(_bundle(), {})
	_expect(engine.set_property("@gold", 5) == "", "a fitting write returns \"\"")
	var refusal: String = engine.set_property("@gold", "lots")
	_expect(refusal == "\"@patter.gold\" takes a number; \"lots\" doesn't fit", "a misfit returns the reference's message: " + refusal)
	_expect(engine.get_property("@gold") == 5.0, "and changes nothing: " + str(engine.get_property("@gold")))
	refusal = engine.set_property("@mood", "angry")
	_expect(refusal == "\"@patter.mood\" takes one of \"calm\", \"tense\"; \"angry\" doesn't fit", "an enum lists what it takes: " + refusal)
	_expect(engine.set_property("@mood", "") == "", "an enum whose default is \"\" takes \"\" back")
	refusal = engine.set_property("@silver", 1)
	_expect(refusal == "no property at \"@patter.silver\": the content declares no @patter.silver", "an undeclared name is refused: " + refusal)
	refusal = engine.set_property("@world.alarm", 1)
	_expect(refusal == "\"@world.alarm\" takes true or false; 1 doesn't fit", "a host scope's declaration is checked: " + refusal)
	_expect(engine.set_property("@world.alarm", true) == "", "and a fitting value written")

	var flow := engine.open_flow("main", "s")
	refusal = flow.set_property("@scene.count", "many")
	_expect(refusal == "\"@scene.count\" takes a number; \"many\" doesn't fit", "a flow's write is checked the same way: " + refusal)
	_expect(flow.get_property("@scene.count") == 0.0, "and changes nothing: " + str(flow.get_property("@scene.count")))
	_expect(flow.set_property("@scene.count", 3) == "", "a flow's fitting write returns \"\"")
	_expect(flow.get_property("@scene.count") == 3.0, "and lands")


func _check_last_error() -> void:
	var engine := PatterEngine.new(_bundle(), {})
	var flow := engine.open_flow("main", "s")
	_expect(flow.last_error() == "", "a fresh flow has no error")
	flow.choose("a")
	_expect(flow.last_error() == "no choice is pending", "a refused choose says why: " + flow.last_error())
	_expect(flow.advance().get("text") == "hello", "and the flow carries on")
	_expect(flow.last_error() == "", "a successful advance clears it")
	var step: Dictionary = flow.advance()
	_expect(step["type"] == "choice", "the choice is reached")
	flow.choose("nope")
	_expect(flow.last_error() == "unknown choice option: nope", "an unknown option says why: " + flow.last_error())
	flow.choose("a")
	_expect(flow.last_error() == "", "a successful choose clears it")
	_expect(flow.advance().get("text") == "asked", "and plays")

	# A jump to nowhere, part way through an advance: the advance returns end and says why.
	var bundle := _bundle()
	bundle["scenes"]["s"]["blocks"][0]["children"][0]["jump"] = {"to": "nowhere"}
	var broken := PatterEngine.new(bundle, {}).open_flow("main", "s")
	broken.advance()
	var refused: Dictionary = broken.advance()
	_expect(refused["type"] == "end" and broken.last_error() == "jump target not found: nowhere",
		"a refused advance returns end and keeps its reason: %s / %s" % [refused, broken.last_error()])


func _expect(ok: bool, what: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what)
