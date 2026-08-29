# The debug registry, headless: it must be an OBSERVER - able to say what is live, unable to keep
# anything alive (from-storylets/weak-debug-registries). Godot held engines strongly where Unity and
# Unreal held them weakly, which is the inconsistency that prompted the note.
#
#   godot --headless --path ports/godot --script res://test/test_debug_registry.gd
extends SceneTree

var _fails := 0


func _initialize() -> void:
	var EngineT := load("res://addons/patterplay/runtime/engine.gd")
	var LinkT := load("res://addons/patterplay/runtime/debug_link.gd")
	var bundle := { "schema": "patter/bundle@0", "scenes": {}, "strings": {}, "locales": { "default": "en", "included": ["en"] } }

	# An engine is RefCounted: the registry must not be the thing keeping it alive.
	var engine = EngineT.new(bundle)
	PatterDebug.register(engine)
	_expect(PatterDebug.engines.size() == 1, "a registered engine is listed")
	engine = null
	_expect(PatterDebug.engines.size() == 0, "an engine nobody else holds leaves the registry")

	# A link is a Node, so the GAME frees it - the registry's job is to notice, not to hold on.
	_expect(PatterDebug.links.is_empty(), "no link registered reads as none, not as an error")
	var link = LinkT.new("build-hash", "Test")
	PatterDebug.register_link(link)
	_expect(PatterDebug.links.size() == 1, "a registered link is listed")
	var s: Dictionary = link.status()
	_expect(s["build"] == "build-hash", "the link reports the build it handshook")
	_expect(s["url"].begins_with("ws://"), "and the address it dials")
	# Nothing is listening in a test, so this is connecting or closed - never a lie about being
	# connected, which is the whole reason the panel shows it.
	_expect(s["state"] in ["connecting", "connected", "closed"], "and an honest state (got %s)" % s["state"])
	PatterDebug.unregister_link(link)
	_expect(PatterDebug.links.is_empty(), "unregistering drops it")

	var freed = LinkT.new("b2")
	PatterDebug.register_link(freed)
	freed.free()
	_expect(PatterDebug.links.is_empty(), "a freed link leaves the registry on its own")

	link.free()
	PatterDebug.clear()
	print("test_debug_registry: %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(1 if _fails > 0 else 0)


func _expect(cond: bool, what: String) -> void:
	if not cond:
		_fails += 1
		printerr("  FAIL: %s" % what)
