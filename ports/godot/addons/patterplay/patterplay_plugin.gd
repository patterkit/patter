@tool
extends EditorPlugin

# The Patterplay runtime is plain GDScript (PatterEngine / PatterFlow / ...), usable with or without
# enabling this plugin. What the plugin adds is the EDITOR half: a .patterc imports as a
# PatterBundleResource, and selecting one shows the bundle inspector - the same summary Unity's
# CustomEditor and Unreal's details customisation draw.
#
# THE EXPORT PLUGIN IS NOT OPTIONAL (#45). Importing a bundle makes Godot ship the imported product
# and drop the source, so `FileAccess.get_file_as_string("res://game.patterc")` - how every project
# loads a bundle - read NOTHING in an exported build. That shipped in 0.4.3 and broke real games.
# The export plugin puts the raw bundle back at its own path and skips the imported product, so a
# build carries exactly what it did before any of this, at the same size. The three are one feature:
# importing without exporting is the bug.
#
# ports/godot/test/export_check.sh is the gate. It exports a project and RUNS the pack, because
# everything else here runs in the editor, where the file is on disk whatever the addon does to it.

const BundleImportPlugin := preload("res://addons/patterplay/editor/patter_bundle_import_plugin.gd")
const BundleInspectorPlugin := preload("res://addons/patterplay/editor/patter_bundle_inspector_plugin.gd")
const BundleExportPlugin := preload("res://addons/patterplay/editor/patter_bundle_export_plugin.gd")

var _import_plugin: EditorImportPlugin
var _inspector_plugin: EditorInspectorPlugin
var _export_plugin: EditorExportPlugin


func _enter_tree() -> void:
	# Export plugin FIRST: it is what keeps a build readable, and registering it before the importer
	# means no window in which bundles are imported without it.
	_export_plugin = BundleExportPlugin.new()
	add_export_plugin(_export_plugin)
	_import_plugin = BundleImportPlugin.new()
	add_import_plugin(_import_plugin)
	_inspector_plugin = BundleInspectorPlugin.new()
	add_inspector_plugin(_inspector_plugin)


func _exit_tree() -> void:
	if _inspector_plugin != null:
		remove_inspector_plugin(_inspector_plugin)
		_inspector_plugin = null
	if _import_plugin != null:
		remove_import_plugin(_import_plugin)
		_import_plugin = null
	# Removed LAST, mirroring the registration order: nothing should be importable without the export
	# plugin that keeps builds readable.
	if _export_plugin != null:
		remove_export_plugin(_export_plugin)
		_export_plugin = null
