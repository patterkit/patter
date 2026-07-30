# PatterStateLogger: a debug companion that watches the mutable runtime state - `@patter` globals,
# per-scene `@scene` props, and visit counts (shared + per-flow) - and reports what changed between
# captures. `log_step` traces each played step, including the `gameData` payload. Built on
# `engine.save_game()`, so it sees exactly what a save persists.
#
# The port of play-helpers' logger.ts: the flattened path scheme (`@patter.x`, `@scene:scene.x`,
# `visit:nodeId`, `flowId/...`) and the line format (`tag path: from -> to`, `<unset>` for missing)
# are the cross-runtime contract; only the traversal of the native save shape differs.
#
#   var logger := PatterStateLogger.new(engine)          # sink defaults to print
#   var step = flow.advance()
#   logger.log_step(step)
#   logger.capture()                                     # logs every mutation since the last capture
class_name PatterStateLogger
extends RefCounted

var _engine
var _sink: Callable
var _tag: String
var _baseline: Dictionary


func _init(engine, sink: Callable = Callable(), label: String = "") -> void:
	_engine = engine
	_sink = sink if sink.is_valid() else func(line: String) -> void: print(line)
	_tag = "[%s] " % label if label != "" else ""
	_baseline = PatterStateLogger.snapshot_state(engine)


## Flatten the engine's whole-game state into a path -> value map (shared scopes + every live flow).
static func snapshot_state(engine) -> Dictionary:
	var save: Dictionary = engine.save_game()
	var out := {}
	for name in save["shared"]:
		out["@patter.%s" % name] = save["shared"][name]
	for scene in save["stage_bags"]:
		for name in save["stage_bags"][scene]:
			out["@scene:%s.%s" % [scene, name]] = save["stage_bags"][scene][name]
	for id in save["shared_visits"]:
		out["visit:%s" % id] = save["shared_visits"][id]
	for fid in save["flows"]:
		var snap: Dictionary = save["flows"][fid]
		for name in snap["scopes"]:
			out["%s/@patter.%s" % [fid, name]] = snap["scopes"][name]
		for scene in snap["scene_bags"]:
			for name in snap["scene_bags"][scene]:
				out["%s/@scene:%s.%s" % [fid, scene, name]] = snap["scene_bags"][scene][name]
		for id in snap["visits"]:
			out["%s/visit:%s" % [fid, id]] = snap["visits"][id]
	return out


## The sorted list of paths that differ between two snapshots. Each change is
## { "path": String, "from": Variant, "to": Variant } with null for absent sides.
static func diff_state(prev: Dictionary, next: Dictionary) -> Array:
	var keys := {}
	for k in prev: keys[k] = true
	for k in next: keys[k] = true
	var sorted := keys.keys()
	sorted.sort()
	var changes: Array = []
	for path in sorted:
		var from = prev.get(path)
		var to = next.get(path)
		if format_value(from) != format_value(to):
			changes.append({ "path": path, "from": from, "to": to })
	return changes


## JSON.stringify-compatible rendering (the logger line contract); null -> "<unset>".
## Whole floats print as integers ("1", not "1.0"): JS numbers make no int/float distinction,
## and a JSON round-trip (e.g. a save/load) turns Godot ints into floats - the value is the
## same value, so it must render the same way.
static func format_value(v) -> String:
	if v == null:
		return "<unset>"
	if v is float and is_finite(v) and v == floor(v) and absf(v) < 9007199254740992.0:
		return str(int(v))
	return JSON.stringify(v)


## The current flattened state (no logging).
func snapshot() -> Dictionary:
	return PatterStateLogger.snapshot_state(_engine)


## Diff since the last capture, log each change, and re-baseline. Returns the changes.
func capture() -> Array:
	var next := PatterStateLogger.snapshot_state(_engine)
	var changes := PatterStateLogger.diff_state(_baseline, next)
	_baseline = next
	for c in changes:
		_sink.call("%s%s: %s -> %s" % [_tag, c["path"], format_value(c["from"]), format_value(c["to"])])
	return changes


## Trace one played step (line / text / game-event / choice / end), including any gameData.
func log_step(step: Dictionary) -> void:
	_sink.call(_tag + _describe(step))


static func _describe(step: Dictionary) -> String:
	var data := ""
	if step.has("gameData") and not (step["gameData"] as Dictionary).is_empty():
		data = " gameData=%s" % JSON.stringify(step["gameData"])
	match step.get("type", ""):
		"line":
			return "line %s: %s%s" % [step.get("character", "?"), JSON.stringify(step.get("text", "")), data]
		"text":
			return "text: %s%s" % [JSON.stringify(step.get("text", "")), data]
		"gameEvent":
			return "game event %s%s" % [step.get("id", ""), data]
		"choice":
			var n: int = (step.get("options", []) as Array).size()
			return "choice (%d option%s)" % [n, "" if n == 1 else "s"]
		"end":
			return "end"
	return str(step.get("type", "?"))
