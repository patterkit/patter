# Steering (patterkit design/proposals/patterplay-steering.md): a tool's steerer answers every gate and
# pick. The corpus pins what each answer does on all four runtimes; this pins what it can't: an answer
# that isn't one (refused as choose() refuses an unknown option, since GDScript can't throw), a steerer
# of the wrong shape, a steerer that left a method out, and a hot swap keeping the steerer. JS's
# steer.test.ts.
#
#   godot --headless --path ports/godot --script res://test/test_steer.gd
extends SceneTree

var _fails := 0


## A steerer made of Callables, so each check can give it the answers it needs. Its methods are untyped,
## so it can hand back an answer of the wrong type.
class Steer extends RefCounted:
	var gate_with: Callable
	var pick_with: Callable

	func _init(g: Callable, p: Callable) -> void:
		gate_with = g
		pick_with = p

	func gate(point):
		return gate_with.call(point)

	func pick(point):
		return pick_with.call(point)


## A steerer with only a gate method: a pick answers its default.
class GateOnly extends RefCounted:
	func gate(_point) -> bool:
		return true


## A steerer with only a pick method: a gate answers its default.
class PickOnly extends RefCounted:
	func pick(_point) -> String:
		return "sn_yes"


## Not a steerer: a `pick` that's a property, not a method.
class PickProperty extends RefCounted:
	var pick = 1


const MET := {"src": "@met", "ast": ["sv", "patter", "met"]}


func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"A": "a", "YES": "yes", "NO": "no"}},
		"properties": [{"name": "met", "type": "boolean", "default": false}],
		"scenes": {"s": {"id": "s", "gameId": "s", "blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "sn_a", "type": "snippet", "condition": MET, "beats": [{"id": "A", "kind": "text"}]},
			{"id": "g", "type": "group", "selector": "branch", "children": [
				{"id": "sn_yes", "type": "snippet", "condition": MET, "beats": [{"id": "YES", "kind": "text"}]},
				{"id": "sn_no", "type": "snippet", "beats": [{"id": "NO", "kind": "text"}]},
			]},
			{"id": "sn_end", "type": "snippet", "jump": {"to": "END"}},
		]}]}},
	}


## Play the flow to its end: the texts it showed, and the last_error() of the advance that ended it.
func _play(engine: PatterEngine) -> Dictionary:
	var flow := engine.open_flow("main", "s")
	var out: Array = []
	for i in 100:
		var r := flow.advance()
		if r["type"] == "end":
			return {"texts": out, "error": flow.last_error()}
		if r["type"] == "text":
			out.append(r["text"])
	return {"texts": out, "error": "did not end"}


func _initialize() -> void:
	var bundle := _bundle()
	var listen_gate := func(p): return p["default"]
	var listen_pick := func(p): return p["default"]

	# A pick naming a child the group doesn't have is refused, as choose() with an unknown id is.
	var r := _play(PatterEngine.new(bundle, {"steer": Steer.new(listen_gate, func(_p): return "sn_nowhere")}))
	_expect(r["error"] == "steer: pick for g answered \"sn_nowhere\", which isn't one of its children",
		"an unknown pick id is refused: " + str(r))
	# Refused as an advance() settles (not as open_flow does), that advance says so too.
	r = _play(PatterEngine.new(bundle, {"steer": Steer.new(func(_p): return true, func(_p): return "sn_nowhere")}))
	_expect(r["texts"] == ["a"] and r["error"].contains("isn't one of its children"),
		"a pick refused in an advance ends that advance: " + str(r))

	# An answer of the wrong type is refused.
	r = _play(PatterEngine.new(bundle, {"steer": Steer.new(func(_p): return "yes", listen_pick)}))
	_expect(r["error"] == "steer: gate for sn_a answered yes, not true or false", "a gate's non-bool is refused: " + str(r))
	r = _play(PatterEngine.new(bundle, {"steer": Steer.new(listen_gate, func(_p): return true)}))
	_expect(r["error"] == "steer: pick for g answered true, not a child id or \"\"", "a pick's non-String is refused: " + str(r))

	# A steerer of the wrong shape is reported as a set-up problem and ignored.
	for steer in [42, {"gate": "always"}, PickProperty.new()]:
		var errors: Array = []
		var engine := PatterEngine.new(bundle, {"steer": steer, "on_error": func(e): errors.append(e)})
		_expect(errors.size() == 1 and errors[0]["kind"] == "setup" and errors[0]["node"] == "steer",
			"a steerer of the wrong shape (%s) is a set-up problem: %s" % [str(steer), str(errors)])
		r = _play(engine)
		_expect(r["texts"] == ["no"] and r["error"] == "", "a steerer of the wrong shape is ignored: " + str(r))

	# A listening steerer is no set-up problem, and changes nothing.
	var none: Array = []
	r = _play(PatterEngine.new(bundle, {"steer": Steer.new(listen_gate, listen_pick), "on_error": func(e): none.append(e)}))
	_expect(none.is_empty() and r["texts"] == ["no"], "a listening steerer changes nothing: %s %s" % [str(none), str(r)])

	# A method left out answers the default for its kind.
	r = _play(PatterEngine.new(bundle, {"steer": GateOnly.new()}))
	_expect(r["texts"] == ["a", "no"], "a steerer with only a gate: " + str(r))
	r = _play(PatterEngine.new(bundle, {"steer": PickOnly.new()}))
	_expect(r["texts"] == ["yes"], "a steerer with only a pick: " + str(r))

	# A hot swap keeps the steerer.
	var first := PatterEngine.new(bundle, {"steer": Steer.new(func(_p): return true, func(_p): return "sn_yes")})
	r = _play(first.hot_swap(bundle))
	_expect(r["texts"] == ["a", "yes"], "a hot swap keeps the steerer: " + str(r))

	print("test_steer: ALL PASS" if _fails == 0 else "test_steer: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: " + what)
