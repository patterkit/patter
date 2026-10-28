# GENERATED - vendored from expr/ports/godot/bundle_export_plugin.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# The bundle export plugin, for Godot. THE SHARED SOURCE.
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# WHY THIS IS SHARED, when it is only a dozen lines of engine boilerplate.
#
# The importer turns a compiled bundle into a Resource so the Inspector has
# something to draw. That alone changes what ships: Godot exports the imported
# product, and `FileAccess.get_file_as_string("res://game.<ext>")`, which is how
# a game loads a bundle, then reads NOTHING in an exported build.
#
# That shipped, in Patterplay 0.4.3 (patterkit/patter#45): an empty read and a
# cutscene that never advanced. The Storylet Engine had the same importer and no
# export plugin, so it had the same bug waiting for its first export, and the
# fix was written a second time by hand. One bug, found once, fixed twice. That
# is the whole argument for this file existing once.
#
# So the editor gets its Resource and the build gets its file: the original
# bytes go back at the original path, and skip() drops the imported copy.
# Without the skip a pack carries the whole story twice (measured at 7.2 MB
# against 3.6 MB for a 3.4 MB bundle).
#
# BUT THE SKIP ALONE BROKE THE RESOURCE. skip() drops the imported product AND
# its `.import` remap, and `load("res://game.<ext>")` needs the remap: at runtime
# there is no importer, so ResourceLoader finds a resource only by reading
# `res://game.<ext>.import`, whose [remap] path names the file under
# `.godot/imported/`. With neither in the build, load() returned null, and so did
# every scene that held the bundle as an exported Resource (the scene itself
# failed to load). In the editor both are on disk, so nothing there could see it.
#
# So the build gets a STAND-IN at the imported path, and the remap back: a tiny
# text resource whose built-in script extends the addon's own Resource class and
# fills `json_text` from the raw file as it loads. `is <Family>BundleResource`
# holds, the uid still resolves (the remap keeps it), and the bundle's bytes are
# in the pack once. The importer's other stored properties (import_error) are
# carried over as they are.
#
# NO `class_name`: Godot registers those project-wide. Each addon subclasses
# this and fills in the three things that differ.
# ---------------------------------------------------------------------------
@tool
extends EditorExportPlugin

## The export plugin's name, as Godot lists it.
var plugin_name := "BundleExport"
## The compiled-bundle extension this addon owns, with its dot.
var bundle_extension := ""
## The addon's name, for the warning if a re-add fails.
var addon_label := "Bundle"


func _get_name() -> String:
	return plugin_name


func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
	if bundle_extension == "" or not path.ends_with(bundle_extension):
		return
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_warning("%s: could not re-add %s to the export" % [addon_label, path])
		return
	var bytes := f.get_buffer(f.get_length())
	f.close()
	# Built before skip(): a bundle the stand-in cannot be made for still ships
	# its raw bytes, as it always did, and says why load() will not find it.
	var stand_in := _stand_in(path)
	skip()
	add_file(path, bytes, false)
	if stand_in.is_empty():
		return
	add_file(stand_in.path, stand_in.resource.to_utf8_buffer(), false)
	add_file(path + ".import", stand_in.remap.to_utf8_buffer(), false)


## The stand-in for an imported bundle: {path, resource, remap}, the resource's
## text and the `.import` text that points load() at it. {} when the bundle is
## not imported as a Resource (a "keep" or "skip" import has no [remap] path).
func _stand_in(path: String) -> Dictionary:
	var cfg := ConfigFile.new()
	if cfg.load(path + ".import") != OK or not cfg.has_section_key("remap", "path"):
		return {}
	var target := str(cfg.get_value("remap", "path"))
	var imported := ResourceLoader.load(path)
	var script: Script = imported.get_script() if imported != null else null
	if script == null or script.resource_path == "" or not "json_text" in imported:
		push_warning("%s: %s ships as a file only; load() will not find it in this build (its imported Resource has no json_text script)" % [addon_label, path])
		return {}

	var source := "extends %s\n\n" % var_to_str(script.resource_path)
	source += "# Written by the bundle export plugin: the exported stand-in for %s.\n" % path
	source += "# The bytes ship once, as the raw file; this reads them as it loads.\n"
	source += "func _init() -> void:\n\tjson_text = FileAccess.get_file_as_string(%s)\n" % var_to_str(path)

	var props := ""
	for p in imported.get_property_list():
		var usage: int = p.usage
		if not (usage & PROPERTY_USAGE_SCRIPT_VARIABLE) or not (usage & PROPERTY_USAGE_STORAGE):
			continue
		if p.name == "json_text":
			continue
		props += "%s = %s\n" % [p.name, var_to_str(imported.get(p.name))]

	var resource := "[gd_resource type=\"Resource\" load_steps=2 format=3]\n\n"
	resource += "[sub_resource type=\"GDScript\" id=\"stand_in\"]\n"
	resource += "script/source = %s\n\n" % var_to_str(source)
	resource += "[resource]\nscript = SubResource(\"stand_in\")\n" + props

	# Only the [remap] section ships, as Godot's own export does for an import.
	var remap := ConfigFile.new()
	for key in cfg.get_section_keys("remap"):
		remap.set_value("remap", key, cfg.get_value("remap", key))
	return {path = target, resource = resource, remap = remap.encode_to_text()}
