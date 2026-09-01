# GENERATED - vendored from expr/ports/godot/bundle_import_plugin.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# The bundle import plugin, for Godot. THE SHARED SOURCE.
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# Turns a compiled bundle into a Resource so the Inspector has something to
# draw. This is the file that CREATED the export bug: importing changes what
# ships, so a build then reads nothing from `res://game.<ext>` unless the export
# plugin puts the original bytes back. The two live and die together, which is
# the argument for both of them existing once. See bundle_export_plugin.gd.
#
# NO `class_name`: Godot registers those project-wide. Each addon subclasses
# this, sets the four names, and overrides _make_resource with its own type.
# ---------------------------------------------------------------------------
@tool
extends EditorImportPlugin

## Godot's internal id for this importer, e.g. "patterplay.bundle".
var importer_name := ""
## What the import dock calls it, e.g. "Patter Bundle".
var visible_name := ""
## The compiled-bundle extension this addon owns, without its dot.
var bundle_extension := ""
## Prefix for push_error, e.g. "PatterBundleImportPlugin".
var log_prefix := "BundleImportPlugin"


## Make the addon's own bundle Resource. Subclasses MUST override: the shared
## source cannot name a class that only exists downstream.
func _make_resource() -> Resource:
	push_error("%s: _make_resource was not overridden" % log_prefix)
	return null


func _get_importer_name() -> String:
	return importer_name


func _get_visible_name() -> String:
	return visible_name


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray([bundle_extension])


func _get_save_extension() -> String:
	return "tres"


func _get_resource_type() -> String:
	return "Resource"


func _get_preset_count() -> int:
	return 1


func _get_preset_name(_preset_index: int) -> String:
	return "Default"


func _get_import_options(_path: String, _preset_index: int) -> Array[Dictionary]:
	return []


func _get_option_visibility(_path: String, _option_name: StringName, _options: Dictionary) -> bool:
	return true


func _get_priority() -> float:
	return 1.0


func _get_import_order() -> int:
	return 0


func _import(source_file: String, save_path: String, _options: Dictionary,
		_platform_variants: Array[String], _gen_files: Array[String]) -> Error:
	var f := FileAccess.open(source_file, FileAccess.READ)
	if f == null:
		push_error("%s: cannot open %s" % [log_prefix, source_file])
		return ERR_CANT_OPEN
	var text := f.get_as_text()
	f.close()
	var res := _make_resource()
	if res == null:
		return ERR_CANT_CREATE
	res.json_text = text
	# A bundle that does not parse still imports, carrying its error: the
	# Inspector shows what is wrong rather than the asset silently vanishing.
	if not res.is_valid():
		res.import_error = ", ".join(res.get_errors())
		push_error("%s: %s: %s" % [log_prefix, source_file, res.import_error])
	var err := ResourceSaver.save(res, "%s.%s" % [save_path, _get_save_extension()])
	if err != OK:
		push_error("%s: ResourceSaver.save failed: %d" % [log_prefix, err])
	return err
