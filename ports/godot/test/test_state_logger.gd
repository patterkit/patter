@tool
extends SceneTree

# The state logger, which had no test in this port at all - which is how it kept its own
# copy of the value-rendering rules and its own diff, both of which the shared core already
# had. This pins the two things that are contracts:
#
#   the LINE FORMAT, `tag path: from -> to`, shared with the JS / C# / C++ runtimes, whole
#   floats rendered as integers because JS numbers make no int/float distinction
#
#   PUSH semantics: a property write logs when it LANDS, not at the next capture, so a
#   value that changed and changed back is reported twice rather than not at all
#
#   godot --headless --path ports/godot --script res://test/test_state_logger.gd

var _fails := 0


func _initialize() -> void:
	var EngineT := load("res://addons/patterplay/runtime/engine.gd")
	var bundle := {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"T": "hi"}},
		"properties": [{"name": "gold", "type": "number", "default": 0, "shared": true}],
		"scenes": {"s": {"id": "s", "gameId": "s", "blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "sn", "type": "snippet", "beats": [{"id": "T", "kind": "text"}], "jump": {"to": "END"}},
		]}]}},
	}
	var engine = EngineT.new(bundle, {})
	var lines: Array = []
	var logger := PatterStateLogger.new(engine, func(l: String) -> void: lines.append(l), "t")

	# A write logs as it lands - nothing has captured yet.
	engine.set_property("@gold", 7)
	_check("a write logs when it lands", lines == ["[t] @patter.gold: 0 -> 7"], str(lines))

	# Whole floats render as integers: the cross-runtime line contract.
	_check("a whole number renders like JS", lines[0].ends_with("0 -> 7"), str(lines))

	var changes := logger.capture()
	_check("capture returns the pushed write", changes.size() == 1 and changes[0]["path"] == "@patter.gold", str(changes))
	_check("and does not say it twice", lines.size() == 1, str(lines))
	_check("a quiet capture is empty", logger.capture().is_empty(), "")

	# Changed and changed back: invisible to a differ, two lines here.
	lines.clear()
	engine.set_property("@gold", 1)
	engine.set_property("@gold", 7)
	_check("a value that changed and changed back is reported",
		lines == ["[t] @patter.gold: 7 -> 1", "[t] @patter.gold: 1 -> 7"], str(lines))

	# A flow opened after the logger was made is picked up on the next capture.
	logger.capture()
	lines.clear()
	var flow = engine.open_flow("main", "s", "b")
	logger.capture()
	flow.set_property("@gold", 3)
	_check("a flow opened later is watched", lines.size() >= 1 and lines[-1].contains("@patter.gold"), str(lines))

	logger.dispose()
	lines.clear()
	engine.set_property("@gold", 99)
	_check("dispose makes it inert", lines.is_empty(), str(lines))

	print("test_state_logger: " + ("ALL PASS" if _fails == 0 else str(_fails) + " FAILED"))
	quit(1 if _fails > 0 else 0)


func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)
