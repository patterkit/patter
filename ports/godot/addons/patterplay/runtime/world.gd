# PatterWorld - a ready-made store for the game's @world, as a node you add in the editor.
#
# The engine reads and writes @world through whatever the game binds under the token "world" in the
# "host_scopes" option. That takes a { "get", "set" } Dictionary, or an object with get_property (and
# optionally set_property) methods, which is what this is:
#
#   @export var world: PatterWorld                         # drag the scene's Patter World in
#   var engine := PatterEngine.new(bundle, {"host_scopes": {"world": world}})
#   world.set_value("hasKey", true)                        # the story's "if @world.hasKey" sees it
#   world.changed.connect(_on_world_changed)               # and the game hears the story's writes
#
# A bound world is an EXTERNAL scope in the engine's property registry: the registry reads and writes
# it through this node and never stores or saves it, so the values are the game's, saved by the game.
# Without one, a standalone engine self-backs @world from the declared defaults, which is fine for a run
# that never leaves the engine, but won't see the game. PatterBundle.declares_world(bundle) says whether
# a story reads @world at all, so a game (or a director built on Patterplay) can say so out loud.
#
# Names match case-insensitively: the compiler folds every property reference, so the story asks for
# "haskey" where the game wrote "hasKey", exactly as the engine's own self-backed bag folds. The name as
# first written is kept for names().
#
# A game that keeps its state elsewhere subclasses this and overrides get_property and set_property (the
# story's side) to read its own, or binds any object of its own with those two methods instead. The
# engine keeps Callables to those methods, never lambdas (godotengine/godot#122532), so the node must
# outlive the engines it's bound to.
#
# Two read-only ideas meet here and stay distinct, as on every runtime. A `writable: false` DECLARATION
# is the story's promise, checked by the compiler and refused by the engine whether or not a world is
# bound. set_read_only here is the GAME's policy: a name the story may read but this game won't let it
# write. GDScript can't throw and the registry doesn't read a resolver's answer, so a refused write is
# push_error'd and never lands; the engine doesn't see it as a failed effect. The host's own set_value
# is bound by neither.
#
# Same shape as Unreal's UPatterWorld and Unity's PatterWorld, in Godot's idiom.
class_name PatterWorld
extends Node

## Fired on every change: the host's own set_value (from_story false) and every write that comes
## through the engine, a story's effect or the engine's set_property (from_story true).
signal changed(name: String, value: Variant, from_story: bool)

## Folded name -> value, in first-set order (Dictionaries keep insertion order).
var _values: Dictionary = {}
## Folded name -> the name as first written, for names().
var _written: Dictionary = {}
## Folded names the story may read but not write.
var _read_only: Dictionary = {}


# --- the host's side (never refused) ------------------------------------------------------------

## Set a value. A bool, a number, a String, or flags (an Array of Strings), as the declaration says.
func set_value(name: String, value: Variant) -> void:
	_put(name, value)
	changed.emit(name, value, false)


## The value set for `name`, or null when it's unset.
func get_value(name: String) -> Variant:
	return _values.get(name.to_lower())


func has_value(name: String) -> bool:
	return _values.has(name.to_lower())


## Every name with a value, in first-set order, as first written.
func names() -> PackedStringArray:
	return PackedStringArray(_written.values())


## Refuse the story's writes to `name` (the game's alone: a clock, a flag the story only reads). The
## host's own set_value still lands.
func set_read_only(name: String, read_only: bool) -> void:
	if read_only:
		_read_only[name.to_lower()] = true
	else:
		_read_only.erase(name.to_lower())


func is_read_only(name: String) -> bool:
	return _read_only.has(name.to_lower())


# --- the story's side (what the engine calls; override to read the game's own state) -------------

## A read; null when unset, as the engine takes an unset property. The registry hands names lower-cased.
func get_property(name: String) -> Variant:
	return get_value(name)


## A write through the engine. Refused (push_error, nothing lands, nothing fires) when the game made
## the name read-only and the write would change it; a write of the value it already holds, which a
## checkpoint's rollback makes, passes quietly.
func set_property(name: String, value: Variant) -> void:
	var key := name.to_lower()
	if _read_only.has(key):
		if _values.has(key) and _same(_values[key], value):
			return
		push_error("@world.%s is the game's alone: a story tried to set it" % name)
		return
	_put(name, value)
	changed.emit(name, value, true)


func _put(name: String, value: Variant) -> void:
	var key := name.to_lower()
	if not _written.has(key):
		_written[key] = name
	_values[key] = value


## Equal values, a number of either kind equal to the other (GDScript refuses == across some types).
static func _same(a: Variant, b: Variant) -> bool:
	var numeric := [TYPE_INT, TYPE_FLOAT]
	if numeric.has(typeof(a)) and numeric.has(typeof(b)):
		return float(a) == float(b)
	return typeof(a) == typeof(b) and a == b
