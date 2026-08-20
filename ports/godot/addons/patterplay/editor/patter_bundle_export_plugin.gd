# Puts the RAW bundle back into an exported build.
#
# The importer (patter_bundle_import_plugin.gd) makes a .patterc a Resource so the Inspector has
# something to draw. That alone broke every shipped game in 0.4.3 (#45): Godot exported the imported
# product and `FileAccess.get_file_as_string("res://game.patterc")` - how every project loads a
# bundle - read nothing.
#
# So the editor gets its Resource and the build gets its file: this adds the original bytes back at
# the original path, which is the contract games were written against.
@tool
extends EditorExportPlugin


func _get_name() -> String:
	return "PatterplayBundleExport"


func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
	if not path.ends_with(".patterc"):
		return
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_warning("Patterplay: could not re-add %s to the export" % path)
		return
	var bytes := f.get_buffer(f.get_length())
	f.close()
	# skip() drops the IMPORTED product from the build. Without it the pack carries the story twice -
	# measured at 7.2 MB against 3.6 MB for a 3.4 MB bundle - because the imported resource embeds the
	# same JSON. The resource is an editor convenience; a running game reads the file.
	skip()
	add_file(path, bytes, false)
