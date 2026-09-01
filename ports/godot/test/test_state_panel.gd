@tool
extends SceneTree

# Headless check of the Runtime State panel (ui/state_panel.gd).
#
# The panel is a plain Control, so a headless SceneTree can build it, point it at an engine
# and read back what it drew. Nothing else in this suite runs that walk: the panel asks the
# registry for engines, each engine for its properties and its log, and the Live Link for its
# status, so a change to any of those would otherwise only ever be PARSED here, never run.
#
# Patterplay had no panel test at all until 2026-09-01, where the Storylet Engine has had one.
# That asymmetry is what let the state window's quality dropdown and its decision-log view be
# written and verified by hand instead of by a check.
#
# One step per FRAME, deliberately. The panel drops the old rows with queue_free(), which
# lands at the end of the frame, so two rebuilds in one frame read as both states at once.
#
#   godot --headless --path ports/godot --script res://test/test_state_panel.gd

const PANEL := preload("res://addons/patterplay/ui/state_panel.gd")

var _fails := 0
var _step := 0
var _panel = null
var _engine = null


func _initialize() -> void:
	var EngineT := load("res://addons/patterplay/runtime/engine.gd")
	var bundle := {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"T_yes": "yes"}},
		"properties": [
			{"name": "gold", "type": "number", "default": 0, "shared": true},
			{"name": "mood", "type": "enum", "values": ["calm", "tense"], "default": "calm", "shared": true},
		],
		"scenes": {"s": {"id": "s", "gameId": "s", "blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "sn", "type": "snippet", "beats": [{"id": "T_yes", "kind": "text"}],
				"onExit": [{"kind": "set", "target": "@gold", "value": {"src": "7", "ast": ["n", 7]}}],
				"jump": {"to": "END"}},
		]}]}},
	}
	PatterDebug.clear()
	_engine = EngineT.new(bundle, {"log": true})
	_panel = PANEL.new()
	root.add_child(_panel)


func _process(_delta: float) -> bool:
	var body := _text_of(_panel)
	match _step:
		0:
			_check("nothing registered says so", body.contains("No engines registered"), body)
			PatterDebug.register(_engine)
			_panel._tick()
		1:
			_check("a registered engine gets a section", body.contains("Engine #0"), body)
			_check("the Live Link's state is reported", body.contains("Live Link"), body)
			_check("save and load are offered", body.contains("Save State"), body)
			# The properties the engine declares, by their addresses.
			_check("a declared property is listed", body.contains("@gold"), body)
			_check("and so is the enum", body.contains("@mood"), body)
			# The log section exists even before anything has been decided.
			_check("the decision log has a section", body.contains("Log (decisions)"), body)
			var flow = _engine.open_flow("main", "s", "b")
			for i in range(10):
				var r = flow.advance()
				if r == null or r.get("type", "") == "end":
					break
			_panel._rebuild()
		2:
			# A played flow wrote a property through an effect, and the panel shows BOTH the
			# new value and the decision that caused it. The second is the point: a state view
			# that shows only values cannot say why they changed.
			_check("the log shows the write that landed", body.contains("write @gold"), body)
			_check("with what it replaced", body.contains("-> 7"), body)
			PatterDebug.unregister(_engine)
			_panel._tick()
		_:
			_check("unregistering empties the panel", body.contains("No engines registered"), body)
			PatterDebug.clear()
			print("test_state_panel: %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
			quit(1 if _fails > 0 else 0)
			return true
	_step += 1
	return false


func _text_of(n: Node) -> String:
	var out := ""
	if n is Label:
		out += (n as Label).text + "\n"
	if n is Button:
		out += (n as Button).text + "\n"
	if n is CheckBox:
		out += (n as CheckBox).text + "\n"
	for c in n.get_children():
		out += _text_of(c)
	return out


func _check(label: String, ok: bool, detail: String = "") -> void:
	if not ok:
		_fails += 1
		printerr("  FAIL: %s" % label)
