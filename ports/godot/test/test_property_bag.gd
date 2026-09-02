@tool
extends SceneTree

# The shared PropertyBag's seeding rule, checked against the shared source itself
# (runtime/expr/property_bag.gd, vendored from expr/ports/godot).
#
# One test file, not one per family: `node scripts/vendor-ports.mjs --check` fails the build
# if either family's copy differs from the shared source by a byte, so running this against
# one copy is running it against both. Duplicating the test to prove a duplicated file is
# identical would be its own joke.
#
#   godot --headless --path ports/godot --script res://test/test_property_bag.gd

var _fails := 0


func _initialize() -> void:
	var Bag := load("res://addons/patterplay/runtime/expr/property_bag.gd")

	# A declaration whose "default" KEY EXISTS but holds null. Unreachable from either
	# product's TS model (`default?:` is optional, not nullable, and JSON export drops
	# undefined), so this is about a hand-written or third-party bundle - and about the two
	# halves of one rule agreeing.
	var nulled := {"name": "hp", "type": "number", "default": null}
	var bag = Bag.new([nulled])
	_check("a null default seeds the TYPE default, not null",
		bag.get_value("hp") == 0.0, str(bag.get_value("hp")))
	_check("and the row agrees with the value",
		bag.rows()[0]["default"] == 0.0, str(bag.rows()[0]["default"]))
	_check("default_for said so all along",
		Bag.default_for(nulled) == 0.0, str(Bag.default_for(nulled)))

	# The ordinary cases, so the fix above cannot quietly change them.
	var decls := [
		{"name": "absent", "type": "number"},
		{"name": "present", "type": "number", "default": 5},
		{"name": "flags", "type": "flags"},
		{"name": "quality", "type": "quality", "stages": ["stranger", "friend"]},
		{"name": "enum", "type": "enum", "values": ["calm", "tense"]},
		{"name": "str", "type": "string", "default": "hi"},
		{"name": "bool", "type": "boolean"},
	]
	var b2 = Bag.new(decls)
	_check("absent default -> the type's", b2.get_value("absent") == 0.0, str(b2.get_value("absent")))
	_check("declared default kept", b2.get_value("present") == 5.0, str(b2.get_value("present")))
	_check("flags start empty", b2.get_value("flags") == [], str(b2.get_value("flags")))
	_check("a quality starts at its first stage", b2.get_value("quality") == "stranger", str(b2.get_value("quality")))
	_check("an enum starts at its first value", b2.get_value("enum") == "calm", str(b2.get_value("enum")))
	_check("a string default is kept", b2.get_value("str") == "hi", str(b2.get_value("str")))
	_check("a boolean starts false", b2.get_value("bool") == false, str(b2.get_value("bool")))

	# The clone guard: two bags from ONE declaration set must not share a flags array.
	var shared_decls := [{"name": "marks", "type": "flags", "default": ["a"]}]
	var x = Bag.new(shared_decls)
	var y = Bag.new(shared_decls)
	(x.get_value("marks") as Array).append("b")
	_check("two bags from one declaration set do not share a mutable default",
		y.get_value("marks") == ["a"], str(y.get_value("marks")))

	print("test_property_bag: " + ("ALL PASS" if _fails == 0 else str(_fails) + " FAILED"))
	quit(1 if _fails > 0 else 0)


func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)
