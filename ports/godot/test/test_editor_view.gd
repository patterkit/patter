@tool
extends SceneTree

# Headless check of the EDITOR's bundle view (addons/patterplay/editor/patter_bundle_view.gd).
#
# NOTE (#45): the Inspector view is currently UNREGISTERED - importing a .patterc as a Resource broke
# exported builds, so the importer is off and nothing produces a PatterBundleResource for the view to
# draw. This test keeps running because the view is a plain VBoxContainer and the rows still have to be
# right when it comes back; it is not evidence that a user can see any of this today.
#
# The view is a @tool script that normally only runs inside the Godot editor's Inspector, which is
# exactly why it needs this: nothing else in the suite instantiates it, so a change to it would
# otherwise only ever be parsed, never executed. It is a plain VBoxContainer, so a headless
# SceneTree can build it, hand it a bundle and read the rows back out.
#
#   godot --headless --path ports/godot --script res://test/test_editor_view.gd

const VIEW := preload("res://addons/patterplay/editor/patter_bundle_view.gd")
const BUNDLE_PATH := "res://addons/patterplay/demo/demo.patterc"

var _fails := 0


func _check(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % label)
	else:
		_fails += 1
		print("FAIL %s%s" % [label, ("  (%s)" % detail) if detail != "" else ""])


## Every row of text the view is currently showing, flattened.
func _text_of(node: Node) -> String:
	var out := ""
	if node is RichTextLabel:
		out += (node as RichTextLabel).text + "\n"
	for child in node.get_children():
		out += _text_of(child)
	return out


func _initialize() -> void:
	# Not the checks themselves: a node added during _initialize is readied on the first frame, so
	# the view would still be empty here.
	_run()


func _run() -> void:
	var text := FileAccess.get_file_as_string(BUNDLE_PATH)
	if text == "":
		print("SKIP editor view: no bundle at %s" % BUNDLE_PATH)
		quit(0)
		return

	var view: VBoxContainer = VIEW.new()
	root.add_child(view)
	await process_frame          # _ready builds the labels

	# An ordinary bundle: the sections an integrator opens the asset for.
	var plain := PatterBundleResource.from_json_text(text)
	view.set_bundle_resource(plain)
	var plain_text := _text_of(view)
	_check("the view renders a bundle", plain_text.contains("ADDRESSES"), plain_text.substr(0, 80))
	_check("it lists a callable scene address", plain_text.contains("demo"))
	_check("a bundle with no host scopes says so", plain_text.contains("the game supplies nothing"))
	# No game-data section on a bundle without any: an always-empty section teaches people to skip it.
	_check("no game-data section when there are no fields", not plain_text.contains("GAME DATA"))

	# The same bundle with the two things the demo story lacks and an inspector most needs to show.
	var patched: Dictionary = JSON.parse_string(text)
	patched["localisation"] = { "mode": "ids", "sourceDebug": true }
	patched["scopeRegistry"] = { "version": 1, "scopes": [
		{ "token": "world", "declarations": [
			{ "name": "isnight", "type": "boolean", "default": true },
			{ "name": "weather", "type": "string" },
		] },
		{ "token": "game" },
	] }
	view.set_bundle_resource(PatterBundleResource.from_json_text(JSON.stringify(patched)))
	var host_text := _text_of(view)
	_check("host properties are named", host_text.contains("@world"), host_text.substr(0, 120))
	# The row an integrator is actually scanning for: a value the game MUST supply.
	_check("a property with no default is marked", host_text.contains("(no default)"))
	_check("an opaque scope reads as unchecked, not empty", host_text.contains("any name, unchecked"))
	_check("a source-debug build says it is not shippable", host_text.contains("not shippable"))

	# A broken bundle still imports, and the asset carries its diagnosis.
	var broken := PatterBundleResource.new()
	broken.json_text = "{ not json"
	view.set_bundle_resource(broken)
	var broken_text := _text_of(view)
	_check("a broken bundle says so rather than rendering nothing", broken_text.contains("Bundle failed to load"))
	_check("and says where it broke", broken_text.contains("line"), broken_text.substr(0, 120))

	print("EDITOR VIEW %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
