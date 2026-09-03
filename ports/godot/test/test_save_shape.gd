@tool
extends SceneTree

# The save envelope's SHAPE, pinned deliberately: it is the FAMILY's (`patter/save@0`, the JS
# reference's, documented in @patterkit/model and design/patter-schema.md 9), not this addon's.
#
# Until 0.11.0 this addon wrote snake_case keys with the cursor fields flat on the flow, which
# round-tripped perfectly through its own save_game()/load_game() and loaded in no other runtime -
# a save written by a web build died here on its first key. A test that only saves and loads cannot
# see that, so this one checks three things:
#   1. what save_game() writes is the family's shape (camelCase, cursor nested, scopes two-level)
#   2. a HAND-WRITTEN save in that shape, as the JS reference writes it, loads
#   3. a HAND-WRITTEN save in the PRE-0.11.0 shape still loads, because players have them on disk
#
#   godot --headless --path ports/godot --script res://test/test_save_shape.gd

var _fails := 0


func _initialize() -> void:
	var EngineT := load("res://addons/patterplay/runtime/engine.gd")
	var bundle := {
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

	var engine = EngineT.new(bundle, {})
	var flow = engine.open_flow("main", "s", "b")
	for i in range(10):
		var r = flow.advance()
		if r == null or r.get("type", "") == "end":
			break

	var save: Dictionary = engine.save_game()

	# 1. the family's shape
	_check("top-level keys are the family's", save.has("sharedVisits") and save.has("stageBags") and save.has("sharedSelectors"), str(save.keys()))
	_check("no snake_case key survives", not save.has("shared_visits") and not save.has("stage_bags"), str(save.keys()))
	_check("shared scopes are two-level", save["shared"].has("patter"), str(save["shared"]))
	var stage: Dictionary = save["stageBags"]["s"]
	_check("stage bag is flat", stage.has("alarm") and not stage.has("values"), str(stage))
	var fsnap: Dictionary = save["flows"]["main"]
	_check("flow scopes are two-level", fsnap["scopes"].has("patter"), str(fsnap["scopes"]))
	_check("the cursor is nested", fsnap.has("cursor") and fsnap["cursor"].has("pendingChoice") and fsnap["cursor"].has("stack"), str(fsnap.keys()))
	_check("cursor fields are not flat on the flow", not fsnap.has("flow_ended") and not fsnap.has("flowEnded"), str(fsnap.keys()))
	var scene: Dictionary = fsnap["sceneBags"]["s"]
	_check("scene bag is flat", scene.has("mood") and not scene.has("values"), str(scene))
	_check("the write landed in it", scene["mood"] == "tense", str(scene))
	_check("an ended flow has a null pending choice, not an empty list", fsnap["cursor"]["pendingChoice"] == null, str(fsnap["cursor"]))

	# JSON is the transport: anything not a plain value would not survive it
	var round_tripped = JSON.parse_string(JSON.stringify(save))
	_check("the envelope survives JSON", round_tripped != null and
		round_tripped["flows"]["main"]["sceneBags"]["s"]["mood"] == "tense", str(round_tripped))

	# 2. a save written by hand in the family's shape - what the JS reference writes - loads
	var engine2 = EngineT.new(bundle, {})
	var family := {
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
			"cursor": {
				"flowEnded": false,
				"currentSceneId": "s",
				"stack": [{"sceneId": "s", "containerId": "b", "index": 0, "nextId": "sn"}],
				"activeSnippetId": null,
				"beatIndex": 0,
				"pendingChoice": null,
				"pendingPromptOwnerId": null,
				"selectors": {},
			},
		}},
	}
	engine2.load_game(family)
	var f2 = engine2.get_flow("main")
	_check("a family-shape scene value loads", f2.get_property("@scene.mood") == "furious", str(f2.get_property("@scene.mood")))
	_check("a family-shape stage value loads", f2.get_property("@scene.alarm") == true, str(f2.get_property("@scene.alarm")))
	_check("a family-shape shared global loads", f2.get_property("@gold") == 7, str(f2.get_property("@gold")))
	_check("the stack came back", f2.current_scene() == "s", str(f2.current_scene()))

	# 3. a save written by hand in the PRE-0.11.0 shape (snake_case, flat cursor) still loads
	var engine3 = EngineT.new(bundle, {})
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
	engine3.load_game(legacy)
	var f3 = engine3.get_flow("main")
	_check("a pre-0.11.0 scene value still loads", f3.get_property("@scene.mood") == "wary", str(f3.get_property("@scene.mood")))
	_check("a pre-0.11.0 stage value still loads", f3.get_property("@scene.alarm") == true, str(f3.get_property("@scene.alarm")))
	_check("a pre-0.11.0 bare shared map still loads", f3.get_property("@gold") == 3, str(f3.get_property("@gold")))
	# and it is written back in the family's shape, so the file is upgraded on the next save
	var resaved: Dictionary = engine3.save_game()
	_check("a legacy save is written back in the family's shape", resaved.has("stageBags") and resaved["flows"]["main"].has("cursor"), str(resaved.keys()))

	print("test_save_shape: " + ("ALL PASS" if _fails == 0 else str(_fails) + " FAILED"))
	quit(1 if _fails > 0 else 0)


func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)
