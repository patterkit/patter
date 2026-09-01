@tool
extends SceneTree

# The save envelope's SHAPE, pinned before scene/stage state moved from hand-rolled
# Dictionaries onto the shared PropertyBag.
#
# The bags are a saved-game format. Whatever they are held in at runtime, `save_game()`
# must keep writing a flat name -> value Dictionary, and must keep reading one written by
# a build that predates the change. A bag that serialised itself - values plus its
# declarations - would round-trip perfectly in a test that only saves and loads, and
# would still have broken every save on disk.
#
# So this checks two different things, and the second is the one that matters:
#   1. what save_game() writes is flat, and survives JSON
#   2. a HAND-WRITTEN save, in the old format, still loads
#
#   godot --headless --path ports/godot --script res://test/test_save_shape.gd

var _fails := 0


func _initialize() -> void:
	var EngineT := load("res://addons/patterplay/runtime/engine.gd")
	var bundle := {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"T": "hi"}},
		"properties": [],
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

	# 1. the stage bag is a flat name -> value map, not a serialised bag
	var stage: Dictionary = save["stage_bags"]["s"]
	_check("stage bag is flat", stage.has("alarm") and not stage.has("values"), str(stage))
	_check("stage value is the scalar itself", typeof(stage["alarm"]) == TYPE_BOOL, str(stage))

	# and so is the flow's scene bag
	var scene: Dictionary = save["flows"]["main"]["scene_bags"]["s"]
	_check("scene bag is flat", scene.has("mood") and not scene.has("values"), str(scene))
	_check("the write landed in it", scene["mood"] == "tense", str(scene))

	# JSON is the transport: anything not a plain value would not survive it
	var round_tripped = JSON.parse_string(JSON.stringify(save))
	_check("the envelope survives JSON", round_tripped != null and
		round_tripped["flows"]["main"]["scene_bags"]["s"]["mood"] == "tense", str(round_tripped))

	# 2. a save written by hand, in the format on disk today, still loads
	var engine2 = EngineT.new(bundle, {})
	var hand := {
		"version": 2,
		"shared": {},
		"shared_visits": {},
		"shared_selectors": {},
		"stage_bags": {"s": {"alarm": true}},
		"flows": {"main": {
			"scopes": {},
			"scene_bags": {"s": {"mood": "furious"}},
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
	engine2.load_game(hand)
	var f2 = engine2.get_flow("main")
	_check("a hand-written scene value loads", f2.get_property("@scene.mood") == "furious",
		str(f2.get_property("@scene.mood")))
	_check("a hand-written stage value loads", f2.get_property("@scene.alarm") == true,
		str(f2.get_property("@scene.alarm")))

	print("test_save_shape: " + ("ALL PASS" if _fails == 0 else str(_fails) + " FAILED"))
	quit(1 if _fails > 0 else 0)


func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)
