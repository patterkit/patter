# PatterSave: wrap the engine's whole-game snapshot in the tagged `patter/save@0` envelope so a
# host can drop it into a file and restore it safely (a foreign blob is refused instead of
# corrupting a run). The whole envelope is the cross-runtime contract: `schema` + `save`, the save in
# the FAMILY's shape (patter/save@0, the JS reference's, written identically by every Patterplay
# runtime), so a file written by any of them loads here and this addon's files load anywhere. Reading
# also accepts a bare version-2 snapshot, so `.patterstate` files written before the envelope existed
# still load, and the snake_case shape this addon wrote before 0.11.0. The save inside is version 3
# (cursors, PRNGs, visits, selectors, and the registry's values when the engine made its own); a
# version 2 save still loads, its values moving into the registry.
#
#   var json := PatterSave.serialize_state(engine)       # -> envelope JSON string
#   var ok := PatterSave.deserialize_state(engine, json) # false (with push_error) on a foreign blob
class_name PatterSave
extends RefCounted

const SCHEMA := "patter/save@0"


## Capture the whole game as a tagged envelope Dictionary (wraps `engine.save_game()`).
static func save_state(engine) -> Dictionary:
	return { "schema": SCHEMA, "save": engine.save_game() }


## Restore a save_state envelope into an engine. Returns false (with push_error) on a foreign blob or
## a save version the engine cannot read. A version 3 save holds no property values unless the engine
## made its own registry: a game that passed its registry saves and loads that itself, in either
## order around this call.
static func load_state(engine, env) -> bool:
	if env is Dictionary and env.get("schema") == SCHEMA and env.get("save") is Dictionary:
		return engine.load_game(env["save"])
	# Bare version-2 snapshot: a .patterstate written before the envelope existed.
	if env is Dictionary and env.get("version", 0) == 2:
		return engine.load_game(env)
	push_error("PatterSave.load_state: not a %s envelope" % SCHEMA)
	return false


## Serialise the whole game to a JSON string (envelope + save-game) - drop into a file.
static func serialize_state(engine, indent: String = "") -> String:
	return JSON.stringify(save_state(engine), indent)


## Parse + restore a serialize_state string. Returns false (with push_error) on malformed JSON
## or a foreign envelope.
static func deserialize_state(engine, json: String) -> bool:
	var data = JSON.parse_string(json)
	if data == null:
		push_error("PatterSave.deserialize_state: malformed JSON")
		return false
	return load_state(engine, data)
