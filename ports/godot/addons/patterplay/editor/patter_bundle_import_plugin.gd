# EditorImportPlugin for .patterc files: teaches Godot to import a compiled bundle as a
# PatterBundleResource so it becomes a first-class asset in the FileSystem dock - the role Unity's
# ScriptedImporter and Unreal's UFactory already play in the sibling ports.
#
# Import model:
#   Source:  <name>.patterc            (JSON text, the cross-runtime contract)
#   Product: .godot/imported/....tres  (PatterBundleResource holding json_text)
#
# A broken bundle still imports: the error lands on the resource (import_error) and in the import
# log, so a bad export shows its diagnosis in-project instead of vanishing.
#
# This does NOT change how the runtime loads a bundle. PatterEngine still takes a parsed Dictionary,
# and reading a .patterc with FileAccess still works exactly as the demo and the docs do it.
@tool
extends EditorImportPlugin


func _get_importer_name() -> String:
	return "patterplay.bundle"


func _get_visible_name() -> String:
	return "Patter Bundle"


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["patterc"])


func _get_save_extension() -> String:
	return "tres"


func _get_resource_type() -> String:
	# Declaring the base "Resource" is the idiom here: a class_name is not referenceable at import
	# registration time. The saved type is PatterBundleResource, which extends Resource.
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
		push_error("PatterBundleImportPlugin: cannot open %s" % source_file)
		return ERR_CANT_OPEN
	var text := f.get_as_text()
	f.close()

	var res := PatterBundleResource.new()
	res.json_text = text
	if not res.is_valid():
		# Import anyway: the asset carries its error instead of disappearing from the dock.
		res.import_error = ", ".join(res.get_errors())
		push_error("PatterBundleImportPlugin: %s: %s" % [source_file, res.import_error])

	var err := ResourceSaver.save(res, "%s.%s" % [save_path, _get_save_extension()])
	if err != OK:
		push_error("PatterBundleImportPlugin: ResourceSaver.save failed: %d" % err)
	return err
