# Choosing from a choice, headless: a greyed (ineligible) option is shown but cannot be taken. JS,
# Unity and Unreal refuse it with "choice option is not eligible"; Godot used to accept it, play its
# content and spend it. A refused choose leaves the choice pending, so the player can still pick.
#
#   godot --headless --path ports/godot --script res://test/test_choose.gd
extends SceneTree

var _fails := 0


func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"C_a": "Ask", "C_b": "Bribe", "T_a": "asked", "T_b": "bribed"}},
		"properties": [{"name": "gold", "type": "number", "default": 0, "shared": true}],
		"scenes": {"s": {"id": "s", "gameId": "s", "blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "g", "type": "group", "selector": "choice", "children": [
				{"id": "a", "type": "group", "prompt": {"id": "C_a", "kind": "text"}, "children": [
					{"id": "a_c", "type": "snippet", "beats": [{"id": "T_a", "kind": "text"}], "jump": {"to": "END"}}]},
				{"id": "z", "type": "group", "condition": {"src": "@gold > 10", "ast": ["bin", ">", ["sv", "patter", "gold"], ["n", 10]]},
					"prompt": {"id": "C_b", "kind": "text"}, "children": [
					{"id": "z_c", "type": "snippet", "beats": [{"id": "T_b", "kind": "text"}], "jump": {"to": "END"}}]},
			]},
		]}]}},
	}


func _initialize() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 1})
	var flow := engine.open_flow("main", "s")
	var step: Dictionary = flow.advance()
	_expect(step["type"] == "choice", "the flow reaches the choice")
	var greyed := false
	for o in step["options"]:
		if o["id"] == "z":
			greyed = not o["eligible"]
	_expect(greyed, "the bribe option is offered greyed")

	flow.choose("z")
	_expect(flow.get_choices().size() == 2, "choosing the greyed option leaves the choice pending")

	flow.choose("a")
	step = flow.advance()
	_expect(step["type"] == "text" and step["text"] == "asked", "the eligible option still plays: " + str(step))

	print("test_choose: ALL PASS" if _fails == 0 else "test_choose: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: " + what)
