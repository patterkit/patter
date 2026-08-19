# PatterBundleResource: a Resource wrapper around a compiled .patterc bundle. Mirrors the Unity
# PatterBundleAsset (a ScriptableObject holding source JSON) and Unreal's UPatterBundle, adapted to
# Godot's Resource model - and it is what makes the two of them possible here at all: an
# EditorInspectorPlugin can only draw for a Resource, and until now a .patterc was a plain file read
# with FileAccess.
#
# Additive on purpose. The runtime still reads a .patterc straight off disk, which is how the demo,
# the docs and every existing project load one; this is for projects that want the bundle as an
# imported asset with an Inspector.
#
# The resource holds the raw JSON text VERBATIM and parses lazily on first use. It does NOT store the
# parsed bundle as sub-properties: that would fork the bundle format, since Godot would re-serialise
# it into .tres shape. The raw JSON is the cross-runtime contract; the parsed form is rebuilt on load.
#
# A broken bundle still imports, carrying its diagnosis in import_error, so a bad export shows what is
# wrong in-project instead of vanishing.
@tool   # the import plugin and the Inspector view call into this, and a non-tool script loads as a
        # placeholder in the editor ("Attempt to call a method on a placeholder instance")
class_name PatterBundleResource
extends Resource

## The raw .patterc JSON text: the single source of truth.
@export_multiline var json_text: String = "":
	set(value):
		json_text = value
		_parsed = false

## The import-time validation error, persisted so a broken bundle's asset carries its diagnosis
## ("" when the import-time parse was clean).
@export var import_error: String = ""

var _parsed := false
var _bundle: Dictionary = {}
var _errors: PackedStringArray = PackedStringArray()


## Build a resource straight from JSON text (the runtime side door for a downloaded or patched
## bundle; no importer involved). Returns null, having pushed the errors, when the text is not a
## valid bundle.
static func from_json_text(text: String) -> PatterBundleResource:
	var r := PatterBundleResource.new()
	r.json_text = text
	if not r.is_valid():
		for e in r.get_errors():
			push_error("PatterBundleResource: %s" % e)
		return null
	return r


## Parse (if needed) and return the bundle Dictionary; {} when invalid (check is_valid to tell an
## empty parse from a broken one).
func get_bundle() -> Dictionary:
	_ensure_parsed()
	return _bundle


func is_valid() -> bool:
	_ensure_parsed()
	return _errors.is_empty()


## Loader errors from the most recent parse attempt.
func get_errors() -> PackedStringArray:
	_ensure_parsed()
	return _errors


## The bundle's content.project, or "" when invalid.
func get_project_name() -> String:
	_ensure_parsed()
	if _errors.is_empty():
		return str(_bundle.get("content", {}).get("project", ""))
	return ""


## Force a re-parse (after writing json_text at runtime). Returns is_valid().
func reload() -> bool:
	_parsed = false
	return is_valid()


func _ensure_parsed() -> void:
	if _parsed:
		return
	_parsed = true
	_bundle = {}
	_errors = PackedStringArray()
	if json_text.strip_edges() == "":
		_errors.append("the bundle is empty")
		return
	# Parsed through the JSON class rather than PatterBundle.load_from_string, which reports failure
	# by returning null: an asset that says WHERE the JSON broke is worth the few extra lines.
	var parser := JSON.new()
	var err := parser.parse(json_text)
	if err != OK:
		_errors.append("line %d: %s" % [parser.get_error_line(), parser.get_error_message()])
		return
	if typeof(parser.data) != TYPE_DICTIONARY:
		_errors.append("not a .patterc bundle (the JSON root is not an object)")
		return
	_bundle = parser.data
	# Cheap shape check, so "imported but unusable" is caught at import rather than at first play.
	if not _bundle.has("scenes"):
		_errors.append("not a .patterc bundle (no \"scenes\")")
		_bundle = {}
