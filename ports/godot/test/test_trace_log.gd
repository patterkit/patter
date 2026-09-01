# The event log, headless: what the engine DECIDED, not what it produced.
#
# A step says which line played. This says why THAT line and not its siblings - which
# children were eligible, which choice options were live. The state logger cannot answer
# that: it sees the effects of the line that ran, never the ones that did not.
#
#   godot --headless --path ports/godot --script res://test/test_trace_log.gd
extends SceneTree

var _fails := 0


func _initialize() -> void:
	var EngineT := load("res://addons/patterplay/runtime/engine.gd")
	# Two snippets under one block: the first gated on a condition that is false, the
	# second unconditional. The block is a `run` container, which is the commonest
	# decision in the engine and the one the JS port originally missed.
	var bundle := {
		"schema": "patter/bundle@0",
		"locales": { "default": "en", "included": ["en"] },
		"strings": { "en": { "T_no": "no", "T_yes": "yes" } },
		"properties": [{ "name": "gate", "type": "boolean", "default": false, "shared": true },
			{ "name": "gold", "type": "number", "default": 0, "shared": true }],
		"scenes": { "s": { "id": "s", "gameId": "s", "blocks": [
			{ "id": "b", "gameId": "b", "children": [
				{ "id": "sn_gated", "type": "snippet", "condition": { "src": "@gate", "ast": ["sv", "patter", "gate"] },
					"beats": [{ "id": "T_no", "kind": "text" }], "jump": { "to": "END" } },
				{ "id": "sn_open", "type": "snippet",
					"beats": [{ "id": "T_yes", "kind": "text" }],
					"onExit": [{ "kind": "set", "target": "@gold", "value": { "src": "7", "ast": ["n", 7] } }],
					"jump": { "to": "END" } },
			] }] } },
	}

	# Off unless asked for: a shipped game pays nothing for a surface it never reads.
	var quiet = EngineT.new(bundle)
	var qf = quiet.open_flow("main", "s", "b")
	_drain(qf)
	_expect(qf.log().is_empty(), "no log unless the run asked for one")
	_expect(quiet.log().is_empty(), "and none on the engine either")

	var engine = EngineT.new(bundle, { "log": true })
	var flow = engine.open_flow("main", "s", "b")
	_drain(flow)

	var sel = _first(flow.log(), "select")
	_expect(sel != null, "the skip past an ineligible sibling is recorded")
	if sel != null:
		# THE REASONING IS IN THE ENTRY: the sibling that lost, and that it lost here.
		var seen: Array = sel["children"]
		_expect(seen.size() == 2, "both children the run walked are named")
		if seen.size() == 2:
			_expect(seen[0]["id"] == "sn_gated" and seen[0]["eligible"] == false,
				"the gated sibling is named as NOT eligible")
			_expect(seen[1]["id"] == "sn_open" and seen[1]["eligible"] == true,
				"the one that ran is named as eligible")
		_expect(sel["picked"] == "sn_open", "and the pick is recorded")

	var w = _first(flow.log(), "write")
	_expect(w != null, "an effect that landed is recorded")
	if w != null:
		_expect(w["target"] == "@gold" and w["value"] == 7, "with its target and value")
		_expect(w.get("prev") == 0, "and what it replaced, so a reader can say 0 -> 7")

	# seq orders the flow and every entry reaches the engine's stream naming its flow.
	var seqs: Array = []
	for e in flow.log():
		seqs.append(e["seq"])
	var sorted := seqs.duplicate()
	sorted.sort()
	_expect(seqs == sorted, "seq is monotonic across the flow")
	_expect(not engine.log().is_empty(), "the engine's stream has the same events")
	for e in engine.log():
		_expect(e["flow"] == "main", "each engine entry names the flow it happened in")

	engine.clear_log()
	_expect(engine.log().is_empty(), "clear_log empties the engine's stream")
	_expect(not flow.log().is_empty(), "a flow's own log is its own")

	print("test_trace_log: %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(1 if _fails > 0 else 0)


func _drain(flow) -> void:
	for i in range(20):
		var r = flow.advance()
		if r == null or r.get("type", "") == "end":
			return


func _first(entries: Array, kind: String):
	for e in entries:
		if e["type"] == kind:
			return e
	return null


func _expect(cond: bool, what: String) -> void:
	if not cond:
		_fails += 1
		printerr("  FAIL: %s" % what)
