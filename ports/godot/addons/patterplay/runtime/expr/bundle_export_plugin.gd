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
	skip()
	add_file(path, bytes, false)
