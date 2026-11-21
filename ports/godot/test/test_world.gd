@tool
extends SceneTree

# PatterWorld: the node a game adds in the editor and binds as `@world`, and the "host_scopes" option
# taking an object with get_property / set_property in place of a { "get", "set" } Dictionary. The
# Godot half of the editor route to `@world` every runtime has (Unity's PatterWorld component, Unreal's
# Patter World component); the code route through a Dictionary is test_one_registry.gd's.
#
#   godot --headless --path ports/godot --script res://test/test_world.gd

var _fails := 0
## What the world's `changed` signal delivered: [name, value, from_story] each.
var _heard: Array = []
## What an engine's "on_error" delivered.
var _errors: Array = []

const WORLD_DECLS := [
	{"name": "hasKey", "type": "boolean", "default": false},
	{"name": "gold", "type": "number", "default": 0},
	{"name": "alarms", "type": "number", "default": 2},
	{"name": "seen", "type": "flags"},
]


## A story that reads @world in a condition ("has key" or "no key") and writes back to it as the
## line ends (gold + 5).
static func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"Y": "has key", "N": "no key"}},
		"properties": [],
		"scopeRegistry": {"version": 1, "scopes": [{"token": "world", "declarations": WORLD_DECLS}]},
		"scenes": {"s": {"id": "s", "gameId": "s", "name": "S", "blocks": [{"id": "b", "gameId": "b", "name": "B", "children": [
			{"id": "yes", "type": "snippet", "condition": {"src": "@world.hasKey", "ast": ["sv", "world", "haskey"]},
				"beats": [{"id": "Y", "kind": "text"}],
				"onExit": [{"kind": "set", "target": "@world.gold",
					"value": {"src": "@world.gold + 5", "ast": ["bin", "+", ["sv", "world", "gold"], ["n", 5]]}}],
				"jump": {"to": "END"}},
			{"id": "no", "type": "snippet", "beats": [{"id": "N", "kind": "text"}], "jump": {"to": "END"}},
		]}]}},
	}


## A game's own store that only reads: get_property and no set_property.
class ReadOnlyState extends RefCounted:
	var gold := 40

	func get_property(name: String) -> Variant:
		return gold if name == "gold" else null


## A game's own store whose set_property answers nothing (void): every write lands.
class VoidState extends RefCounted:
	var values := {}

	func get_property(name: String) -> Variant:
		return values.get(name)

	func set_property(name: String, value: Variant) -> void:
		values[name] = value


## A game's own World, reading its own state instead of the store.
class GameWorld extends PatterWorld:
	var key_in_pocket := true

	func get_property(name: String) -> Variant:
		if name == "haskey":
			return key_in_pocket
		return super.get_property(name)


func _initialize() -> void:
	_the_store()
	_bound()
	_unbound()
	_read_only_through_the_engine()
	_declared_defaults()
	_dictionary_refusal()
	_other_objects()
	_declares_world()
	print("test_world: ALL PASS" if _fails == 0 else "test_world: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


func _on_changed(name: String, value: Variant, from_story: bool) -> void:
	_heard.append([name, value, from_story])


func _on_error(e: Dictionary) -> void:
	_errors.append(e)


static func _first_text(engine: PatterEngine) -> String:
	var flow = engine.open_flow("f", "s")
	var step: Dictionary = flow.advance()
	var text := str(step.get("text", ""))
	for i in range(10):
		if flow.advance().get("type", "") == "end":
			break
	return text


# -- the store, host side and story side ----------------------------------------------

func _the_store() -> void:
	var world := PatterWorld.new()
	_heard = []
	world.changed.connect(_on_changed)
	world.set_value("hasKey", true)
	world.set_value("Gold", 3)
	_check("store: a value reads back", _eq(world.get_value("hasKey"), true), str(world.get_value("hasKey")))
	_check("store: names match case-insensitively", _eq(world.get_value("GOLD"), 3) and world.has_value("haskey"), str(world.get_value("GOLD")))
	_check("store: an unset name reads null", world.get_value("nothing") == null and not world.has_value("nothing"), "")
	_check("store: names() in first-set order, as first written", world.names() == PackedStringArray(["hasKey", "Gold"]), str(world.names()))
	world.set_property("gold", 4)   # the engine's side, names lower-cased by the registry
	_check("store: a story write lands", _eq(world.get_value("Gold"), 4), str(world.get_value("Gold")))
	_check("store: names() keeps the first spelling", world.names() == PackedStringArray(["hasKey", "Gold"]), str(world.names()))
	_check("store: changed tells host writes from story writes",
		_heard == [["hasKey", true, false], ["Gold", 3, false], ["gold", 4, true]], str(_heard))
	world.set_read_only("Gold", true)
	_check("store: is_read_only, any spelling", world.is_read_only("gold"), "")
	_heard = []
	var why = world.set_property("gold", 9)   # refused: answered, nothing lands
	_check("store: read-only refuses a story write", _eq(world.get_value("gold"), 4) and _heard.is_empty(), str(world.get_value("gold")) + " " + str(_heard))
	_check("store: and answers why", why == "@world.gold is the game's alone: a story tried to set it", str(why))
	why = world.set_property("gold", 4.0)   # a rollback's write of the value it holds
	_check("store: a write of the value it holds passes quietly", _heard.is_empty() and why == "", str(_heard) + " " + str(why))
	_check("store: a write that lands answers \"\"", world.set_property("hasKey", false) == "", "")
	world.set_value("gold", 6)
	_check("store: read-only never binds the host", _eq(world.get_value("gold"), 6), str(world.get_value("gold")))
	world.set_read_only("gold", false)
	world.set_property("gold", 7)
	_check("store: and lifts", _eq(world.get_value("gold"), 7) and not world.is_read_only("gold"), str(world.get_value("gold")))
	world.free()


# -- an engine made with a world -----------------------------------------------------

func _bound() -> void:
	var world := PatterWorld.new()
	world.set_value("hasKey", true)
	world.set_value("gold", 2)
	_heard = []
	world.changed.connect(_on_changed)
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": world}})
	_check("bound: the engine is made", engine.init_error() == "", engine.init_error())
	_check("bound: a story condition sees a value set on the world", _first_text(engine) == "has key", "")
	_check("bound: an effect writes back to the world", _eq(world.get_value("gold"), 7), str(world.get_value("gold")))
	_check("bound: the world hears it as the story's write", _heard == [["gold", 7.0, true]], str(_heard))
	_check("bound: the engine reads the world", _eq(engine.get_property("@world.gold"), 7), str(engine.get_property("@world.gold")))
	var save: Dictionary = engine.save_game()
	_check("bound: the world is the game's, never in the engine's save",
		not save.get("registry", {}).has("world"), JSON.stringify(save.get("registry")))
	engine = null
	world.free()


func _unbound() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 1})
	_check("unbound: a standalone engine self-backs @world from the defaults", _first_text(engine) == "no key", "")
	_check("unbound: and stores and saves it", engine.save_game().get("registry", {}).has("world"), "")


# -- the game's read-only policy through the engine ----------------------------------

func _read_only_through_the_engine() -> void:
	var world := PatterWorld.new()
	world.set_value("hasKey", true)
	world.set_value("gold", 2)
	world.set_read_only("gold", true)
	_errors = []
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": world}, "on_error": _on_error})
	var flow = engine.open_flow("f", "s")
	_check("read-only: the story still reads it", str(flow.advance().get("text", "")) == "has key", "")
	_check("read-only: and plays on past the refused write", flow.advance().get("type", "") == "end", "")
	_check("read-only: the story's write never lands", _eq(world.get_value("gold"), 2), str(world.get_value("gold")))
	var got: Array = _errors.map(func(e): return [e.get("kind"), e.get("node"), e.get("flow"), e.get("message")])
	_check("read-only: the refusal reaches on_error as a failed effect",
		got == [["effect", "yes", "f", "@world.gold is the game's alone: a story tried to set it"]], str(_errors))
	_check("read-only: the game's own write through the engine is refused too",
		engine.set_property("@world.gold", 1) == "@world.gold is the game's alone: a story tried to set it"
		and _eq(world.get_value("gold"), 2), str(world.get_value("gold")))
	engine = null
	world.free()


# -- a declared name the game hasn't set reads its declared default --------------------

func _declared_defaults() -> void:
	var world := PatterWorld.new()
	world.set_value("hasKey", true)   # gold, alarms and seen unset
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": world}})
	_check("defaults: an unset number reads its declaration's default", _eq(engine.get_property("@world.alarms"), 2), str(engine.get_property("@world.alarms")))
	_check("defaults: an unset name with no default reads its type's", _eq(engine.get_property("@world.seen"), []), str(engine.get_property("@world.seen")))
	(engine.get_property("@world.seen") as Array).append("x")
	_check("defaults: a flags default is never shared", _eq(engine.get_property("@world.seen"), []), str(engine.get_property("@world.seen")))
	_check("defaults: the fallback never writes the game's store", not world.has_value("alarms") and not world.has_value("seen"), str(world.names()))
	_check("defaults: a story sums on an unset name from its default", _first_text(engine) == "has key" and _eq(world.get_value("gold"), 5), str(world.get_value("gold")))
	world.set_value("alarms", 7)
	_check("defaults: a value the game sets reads through", _eq(engine.get_property("@world.alarms"), 7), str(engine.get_property("@world.alarms")))
	_check("defaults: a name nobody declared still reads null", engine.get_property("@world.nothing") == null, str(engine.get_property("@world.nothing")))
	engine = null
	world.free()

	# A Dictionary resolver gets the same fallback.
	var store := {}
	engine = PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": {"get": func(n): return store.get(n), "set": func(n, v): store[n] = v}}})
	_check("defaults: a Dictionary resolver reads the declared default too", _eq(engine.get_property("@world.alarms"), 2) and store.is_empty(), str(store))


# -- a Dictionary resolver's own refusal -------------------------------------------------

func _dictionary_refusal() -> void:
	var store := {"haskey": true}
	var refusing := {
		"get": func(n): return store.get(n),
		"set": func(n, v): return "the game keeps %s" % n if n == "gold" else _store_put(store, n, v),
	}
	_errors = []
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": refusing}, "on_error": _on_error})
	var flow = engine.open_flow("f", "s")
	_check("dictionary: the story reads through it", str(flow.advance().get("text", "")) == "has key", "")
	_check("dictionary: and plays on past the refused write", flow.advance().get("type", "") == "end", "")
	_check("dictionary: the refused write never lands", not store.has("gold"), str(store))
	var got: Array = _errors.map(func(e): return [e.get("kind"), e.get("node"), e.get("message")])
	_check("dictionary: a \"set\" that answers why reaches on_error as a failed effect",
		got == [["effect", "yes", "the game keeps gold"]], str(_errors))
	_check("dictionary: a \"set\" that answers nothing lands", engine.set_property("@world.alarms", 4) == ""
		and _eq(store.get("alarms"), 4), str(store))


## A write that lands, answering nothing (null).
static func _store_put(store: Dictionary, n: String, v):
	store[n] = v
	return null


# -- other objects in place of a PatterWorld -----------------------------------------

func _other_objects() -> void:
	# An object with get_property and no set_property binds a scope read-only to everyone.
	var state := ReadOnlyState.new()
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": state}})
	_check("own object: read through get_property", _eq(engine.get_property("@world.gold"), 40), str(engine.get_property("@world.gold")))
	var refused: String = engine.set_property("@world.gold", 1)
	_check("own object: no set_property, so even the host's write is refused", refused != "" and state.gold == 40, refused)

	# An object whose set_property answers nothing: every write lands, and nothing is reported.
	var plain := VoidState.new()
	plain.values["haskey"] = true
	_errors = []
	engine = PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": plain}, "on_error": _on_error})
	_check("own object: a void set_property is a write that lands", _first_text(engine) == "has key"
		and _eq(plain.values.get("gold"), 5) and _errors.is_empty(), str(plain.values) + " " + str(_errors))

	# A subclass reads the game's own state. Gold is unset, so the story sums on its declared default.
	var mine := GameWorld.new()
	engine = PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": mine}})
	_check("subclass: an overridden get_property is what the story reads", _first_text(engine) == "has key", "")
	_check("subclass: the store still takes the write back", _eq(mine.get_value("gold"), 5), str(mine.get_value("gold")))
	engine = null
	mine.free()

	# Anything else is reported and left unbound, so the engine self-backs as if nothing were given.
	_errors = []
	engine = PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": "my world"}, "on_error": _on_error})
	var got: Array = _errors.map(_kind_and_node)
	_check("a binding that's neither is reported", got == [["setup", "world"]], str(got))
	_check("and the scope self-backs", engine.init_error() == "" and _first_text(engine) == "no key", engine.init_error())


static func _kind_and_node(e: Dictionary) -> Array:
	return [e["kind"], e["node"]]


func _declares_world() -> void:
	_check("declares_world: a bundle that declares @world", PatterBundle.declares_world(_bundle()), "")
	var none := _bundle()
	none.erase("scopeRegistry")
	_check("declares_world: one with no scope registry", not PatterBundle.declares_world(none), "")
	none["scopeRegistry"] = {"version": 1, "scopes": [{"token": "World", "declarations": []}]}
	_check("declares_world: tokens are case-sensitive", not PatterBundle.declares_world(none), "")


func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)


## Structural equality, a produced float equal to an expected JSON int.
static func _eq(a, b) -> bool:
	var numeric := [TYPE_INT, TYPE_FLOAT]
	if numeric.has(typeof(a)) and numeric.has(typeof(b)):
		return float(a) == float(b)
	return typeof(a) == typeof(b) and a == b
