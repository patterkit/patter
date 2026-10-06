# Choosing from a choice, headless. A greyed (ineligible) option is shown but cannot be taken: JS, Unity
# and Unreal refuse it with "choice option is not eligible"; Godot used to accept it, play its content and
# spend it. A refused choose leaves the choice pending, so the player can still pick. And a chosen prompt
# still waiting to be replayed does not survive a reset or a goto.
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

	_check_pending_cleared()

	print("test_choose: ALL PASS" if _fails == 0 else "test_choose: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


# Moving a flow drops everything waiting to be delivered. With replay_prompt_on_choose, choose() leaves the
# chosen option's prompt waiting to be spoken back by the next advance(). A reset (start) between the two
# used to clear only the choice, so the abandoned run's prompt played as the restarted run's first beat.
func _check_pending_cleared() -> void:
	var bundle := {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"OPEN": "opening", "P": "Ask", "ANS": "answer"}},
		"scenes": {"s": {"id": "s", "gameId": "s", "blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "sn_open", "type": "snippet", "beats": [{"id": "OPEN", "kind": "text"}]},
			{"id": "g", "type": "group", "selector": "choice", "children": [
				{"id": "o", "type": "group", "prompt": {"id": "P", "kind": "line", "character": "PC"}, "children": [
					{"id": "sn_ans", "type": "snippet", "beats": [{"id": "ANS", "kind": "text"}], "jump": {"to": "END"}}]},
			]},
		]}]}},
	}
	var to_chosen := func() -> PatterFlow:
		var flow: PatterFlow = PatterEngine.new(bundle, {"replay_prompt_on_choose": true}).open_flow("f", "s")
		flow.advance()
		flow.advance()
		flow.choose("o")
		return flow
	var replayed: Dictionary = to_chosen.call().advance()
	_expect(replayed["id"] == "P", "a chosen prompt is spoken back by the next advance: " + str(replayed))
	var restarted: PatterFlow = to_chosen.call()
	restarted.reset("s", "")
	var after_reset: Dictionary = restarted.advance()
	_expect(after_reset["id"] == "OPEN", "a reset drops the waiting prompt: " + str(after_reset))
	var moved: PatterFlow = to_chosen.call()
	moved.goto("s")
	var after_goto: Dictionary = moved.advance()
	_expect(after_goto["id"] == "OPEN", "a goto drops it too: " + str(after_goto))


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: " + what)
