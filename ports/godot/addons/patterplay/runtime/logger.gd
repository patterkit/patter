# PatterStateLogger - this addon's NAME for the shared state logger, plus the two
# Patterplay-shaped pieces the kernel asks for, and log_step, which is this product's own.
#
# The core is expr/ports/godot/state_logger.gd, vendored beside this file as
# runtime/expr/state_logger.gd and shared with the Storylet Engine: property writes are
# PUSHED on the PropertyBag audit hook as they land, and only what has no hook (here, the
# visit counts) is diffed on capture(). This logger used to diff whole save_game()
# snapshots, which could only ever report the NET change between captures - a value that
# changed and changed back was invisible, and every write was reported late.
#
# The flattened path scheme (`@patter.x`, `@scene:scene.x`, `visit:nodeId`, `flowId/...`)
# and the line format (`tag path: from -> to`, `<unset>` for missing) are the cross-runtime
# contract and are unchanged; the shared core renders values through the same js_number
# rules this file used to implement itself.
#
#   var logger := PatterStateLogger.new(engine)          # sink defaults to print
#   var step = flow.advance()
#   logger.log_step(step)
#   logger.capture()                                     # visit counts; writes logged already
class_name PatterStateLogger
extends "res://addons/patterplay/runtime/expr/state_logger.gd"

var _engine


func _init(engine, sink: Callable = Callable(), label: String = "") -> void:
	_engine = engine
	var opts := {"label": "[%s] " % label if label != "" else ""}
	if sink.is_valid():
		opts["sink"] = sink
	# Re-read on every capture: open_flow and load_game both replace bags, and the core
	# re-mounts whatever it is handed.
	super._init(
		func() -> Array: return PatterStateLogger._all_mounts(engine),
		func() -> Dictionary: return PatterStateLogger._visit_state(engine),
		opts)


## Every bag the engine and its flows hold, with the path each answers to in a log.
static func _all_mounts(engine) -> Array:
	var mounts: Array = engine.list_bags()
	for f in engine.flows():
		mounts.append_array(f.list_bags())
	return mounts


## Flatten the engine's whole-game state into a path -> value map (shared scopes + every live flow).
## It reads the same mounts the logger does, so the two agree on the path space; the property values
## are the registry's now, and no longer in save_game(). A bag loaded into the registry but not yet
## claimed (a scene no flow has re-entered since a load) appears once it is.
static func snapshot_state(engine) -> Dictionary:
	var out := {}
	for m in _all_mounts(engine):
		var bag = m["bag"]
		var prefix: String = str(m.get("path_prefix", bag.path_prefix))
		var values: Dictionary = bag.save()
		for name in values:
			out["%s%s" % [prefix, name]] = values[name]
	out.merge(_visit_state(engine), true)
	return out


## The visit counts, which live in no bag and so have no audit hook: the core diffs these on
## capture(), which is all this logger used to do for everything.
static func _visit_state(engine) -> Dictionary:
	var save: Dictionary = engine.save_game()
	var out := {}
	for id in save["sharedVisits"]:
		out["visit:%s" % id] = save["sharedVisits"][id]
	for fid in save["flows"]:
		for id in save["flows"][fid]["visits"]:
			out["%s/visit:%s" % [fid, id]] = save["flows"][fid]["visits"][id]
	return out


## The current flattened state (no logging): the whole game, off the save envelope.
func snapshot() -> Dictionary:
	return PatterStateLogger.snapshot_state(_engine)


## Trace one played step (line / text / game-event / choice / end), including any gameData.
func log_step(step: Dictionary) -> void:
	_sink.call(_label + _describe(step))


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
