@tool
extends SceneTree

# The save envelope's SHAPE, pinned deliberately: it is the FAMILY's (`patter/save@0`, the JS
# reference's, documented in @patterkit/model and design/patter-schema.md 9), not this addon's.
#
# Until 0.11.0 this addon wrote snake_case keys with the cursor fields flat on the flow, which
# round-tripped perfectly through its own save_game()/load_game() and loaded in no other runtime -
# a save written by a web build died here on its first key. A test that only saves and loads cannot
# see that, so this one checks what is written, and loads saves written out by HAND:
#   1. what save_game() writes is version 3: no property values but the registry's, each bag a PLAIN
#      record under its registry key, and only when the engine made its own registry
#   2. a hand-written version 3 save, as the JS reference writes it, loads and writes back the same
#   3. a hand-written version 2 save (the shape every runtime wrote before the registry held the
#      properties) loads, its values moving into the registry, alone or beside a game's own load
#   4. a hand-written PRE-0.11.0 save (snake_case, flat cursor, version 2) still loads
#
#   godot --headless --path ports/godot --script res://test/test_save_shape.gd

var _fails := 0

var _bundle := {
	"schema": "patter/bundle@0",
	"locales": {"default": "en", "included": ["en"]},
	"strings": {"en": {"T": "hi"}},
	"properties": [{"name": "gold", "type": "number", "default": 0, "shared": true}],
	"scenes": {"s": {"id": "s", "gameId": "s",
		"sceneProps": [
			{"name": "mood", "type": "string", "default": "calm", "shared": false},
			{"name": "alarm", "type": "boolean", "default": false, "shared": true},
		],
		"blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "sn", "type": "snippet", "beats": [{"id": "T", "kind": "text"}],
				"onExit": [{"kind": "set", "target": "@scene.mood",
					"value": {"src": "\"tense\"", "ast": ["s", "tense"]}}],
				"jump": {"to": "END"}},
		]}]}},
}

## The registry a played standalone game holds, as a player's save carries it.
const PLAYED_REGISTRY := {
	"patter": {"gold": 0},
	"patter/flow/main/patter": {},
	"patter/flow/main/scene/s": {"mood": "tense"},
	"patter/scene/s": {"alarm": false},
}


func _played(options: Dictionary = {}):
	var engine = PatterEngine.new(_bundle, options)
	var flow = engine.open_flow("main", "s", "b")
	for i in range(10):
		if flow.advance().get("type", "") == "end":
			break
	return engine


func _initialize() -> void:
	# 1. what is written
	var save: Dictionary = _played().save_game()
	_check("the save is version 3", _eq(save.get("version"), 3), str(save.get("version")))
	_check("top-level keys are the family's, and only those",
		_sorted(save.keys()) == ["flows", "registry", "sharedSelectors", "sharedVisits", "version"], str(save.keys()))
	_check("a standalone engine carries its registry's values, each bag a plain record under its key",
		_eq(save["registry"], PLAYED_REGISTRY), JSON.stringify(save["registry"]))
	var fsnap: Dictionary = save["flows"]["main"]
	_check("a flow's snapshot holds no properties", _sorted(fsnap.keys()) == ["cursor", "rngState", "visits"], str(fsnap.keys()))
	_check("the cursor is nested", fsnap["cursor"].has("pendingChoice") and fsnap["cursor"].has("stack"), str(fsnap["cursor"].keys()))
	_check("an ended flow has a null pending choice, not an empty list", fsnap["cursor"]["pendingChoice"] == null, str(fsnap["cursor"]))
	# JSON is the transport: anything not a plain value would not survive it
	var round_tripped = JSON.parse_string(JSON.stringify(save))
	_check("the envelope survives JSON", round_tripped is Dictionary and _eq(round_tripped, save), JSON.stringify(round_tripped))
	var again = PatterEngine.new(_bundle, {})
	again.load_game(round_tripped)
	_check("and loads back to the same save", _eq(JSON.parse_string(JSON.stringify(again.save_game())), round_tripped),
		JSON.stringify(again.save_game()))

	# ... and with the game's registry, the values stay out: the game saves the registry once.
	var registry := PatterScopeRegistry.new()
	var in_game = _played({"registry": registry})
	var game_save: Dictionary = in_game.save_game()
	_check("given the game's registry, save_game leaves the values out", not game_save.has("registry"), str(game_save.keys()))
	_check("and the game's registry holds exactly what a standalone save carries", _eq(registry.save(), PLAYED_REGISTRY),
		JSON.stringify(registry.save()))

	# 2. a version 3 save written by HAND - what the JS reference writes - loads and writes back the same
	var on_disk := {
		"version": 3,
		"registry": {
			"patter": {"gold": 7},
			"patter/flow/main/patter": {},
			"patter/flow/main/scene/s": {"mood": "furious"},
			"patter/scene/s": {"alarm": true},
		},
		"sharedVisits": {"s": 1, "b": 1, "sn": 1},
		"sharedSelectors": {},
		"flows": {"main": {
			"rngState": 1,
			"visits": {"s": 1, "b": 1, "sn": 1},
			"cursor": {
				"flowEnded": false, "currentSceneId": "s",
				"stack": [{"sceneId": "s", "containerId": "b", "index": 0, "nextId": "sn"}],
				"activeSnippetId": null, "beatIndex": 0, "pendingChoice": null,
				"pendingPromptOwnerId": null, "selectors": {},
			},
		}},
	}
	var engine2 = PatterEngine.new(_bundle, {})
	_check("a hand-written version 3 save loads", engine2.load_game(on_disk.duplicate(true)), "")
	var f2 = engine2.get_flow("main")
	_check("its scene value", f2.get_property("@scene.mood") == "furious", str(f2.get_property("@scene.mood")))
	_check("its stage value", f2.get_property("@scene.alarm") == true, str(f2.get_property("@scene.alarm")))
	_check("its shared global", _eq(engine2.get_property("@gold"), 7), str(engine2.get_property("@gold")))
	_check("the stack came back", f2.current_scene() == "s", str(f2.current_scene()))
	_check("and it writes back exactly what was read", _eq(JSON.parse_string(JSON.stringify(engine2.save_game())), on_disk),
		JSON.stringify(engine2.save_game()))

	# 3. a version 2 save written by HAND: players have these on disk, and they must keep loading
	var v2 := {
		"version": 2,
		"shared": {"patter": {"gold": 7}},
		"sharedVisits": {"s": 1, "b": 1, "sn": 1},
		"sharedSelectors": {},
		"stageBags": {"s": {"alarm": true}},
		"flows": {"main": {
			"scopes": {"patter": {}},
			"sceneBags": {"s": {"mood": "furious"}},
			"rngState": 1,
			"visits": {"s": 1, "b": 1, "sn": 1},
			"cursor": on_disk["flows"]["main"]["cursor"].duplicate(true),
		}},
	}
	var engine3 = PatterEngine.new(_bundle, {})
	_check("a hand-written version 2 save loads", engine3.load_game(v2.duplicate(true)), "")
	var f3 = engine3.get_flow("main")
	_check("its scene value moved into the registry", f3.get_property("@scene.mood") == "furious", str(f3.get_property("@scene.mood")))
	_check("its stage value", f3.get_property("@scene.alarm") == true, str(f3.get_property("@scene.alarm")))
	_check("its shared global", _eq(engine3.get_property("@gold"), 7), str(engine3.get_property("@gold")))
	var back: Dictionary = engine3.save_game()
	_check("and it is written back as version 3, values under their keys",
		_eq(back.get("version"), 3) and _eq(back.get("registry"), on_disk["registry"]), JSON.stringify(back))

	# ... into a registry the game supplied, beside values the game already loaded for another engine
	var game_reg := PatterScopeRegistry.new()
	game_reg.load({"another-engine/deck/inn": {"drawn": 3}})
	var engine4 = PatterEngine.new(_bundle, {"registry": game_reg})
	engine4.load_game(v2.duplicate(true))
	_check("a version 2 save into the game's registry reaches the flow", engine4.get_flow("main").get_property("@scene.mood") == "furious",
		str(engine4.get_flow("main").get_property("@scene.mood")))
	var want: Dictionary = on_disk["registry"].duplicate(true)
	want["another-engine/deck/inn"] = {"drawn": 3}
	_check("and keeps what the game had loaded", _eq(game_reg.save(), want), JSON.stringify(game_reg.save()))

	# 4. a save written by hand in the PRE-0.11.0 shape (snake_case, flat cursor) still loads
	var engine5 = PatterEngine.new(_bundle, {})
	var legacy := {
		"version": 2,
		"shared": {"gold": 3},
		"shared_visits": {},
		"shared_selectors": {},
		"stage_bags": {"s": {"alarm": true}},
		"flows": {"main": {
			"scopes": {},
			"scene_bags": {"s": {"mood": "wary"}},
			"rng_state": 1.0,
			"visits": {},
			"flow_ended": false,
			"current_scene_id": "s",
			"stack": [{"scene": "s", "container": "b", "index": 0, "next_id": "sn"}],
			"active_snippet_id": "",
			"beat_index": 0,
			"pending_group_id": "",
			"pending_options": [],
			"pending_prompt_owner": "",
			"selectors": {},
		}},
	}
	engine5.load_game(legacy)
	var f5 = engine5.get_flow("main")
	_check("a pre-0.11.0 scene value still loads", f5.get_property("@scene.mood") == "wary", str(f5.get_property("@scene.mood")))
	_check("a pre-0.11.0 stage value still loads", f5.get_property("@scene.alarm") == true, str(f5.get_property("@scene.alarm")))
	_check("a pre-0.11.0 bare shared map still loads", _eq(f5.get_property("@gold"), 3), str(f5.get_property("@gold")))
	var resaved: Dictionary = engine5.save_game()
	_check("a legacy save is written back in the family's shape",
		_eq(resaved.get("version"), 3) and resaved.has("registry") and resaved["flows"]["main"].has("cursor"), str(resaved.keys()))

	# 5. a version it cannot read is refused, and changes nothing
	var engine6 = _played()
	var before: Dictionary = engine6.save_game()
	_check("an unsupported version is refused", engine6.load_game({"version": 4, "flows": {}}) == false, "")
	_check("and leaves the game as it was", _eq(engine6.save_game(), before), JSON.stringify(engine6.save_game()))

	print("test_save_shape: " + ("ALL PASS" if _fails == 0 else str(_fails) + " FAILED"))
	quit(1 if _fails > 0 else 0)


func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)


static func _sorted(a: Array) -> Array:
	var out := a.duplicate()
	out.sort()
	return out


## Structural equality, a produced float equal to an expected JSON int.
static func _eq(a, b) -> bool:
	var num := func(v): return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT
	if num.call(a) and num.call(b):
		return float(a) == float(b)
	if typeof(a) != typeof(b):
		return false
	if a is Dictionary:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not _eq(a[k], b[k]):
				return false
		return true
	if a is Array:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not _eq(a[i], b[i]):
				return false
		return true
	return a == b
