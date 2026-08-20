@tool
extends EditorPlugin

# The Patterplay runtime is plain GDScript (PatterEngine / PatterFlow / ...), usable with or without
# enabling this plugin.
#
# THE IMPORT PLUGIN IS OFF (#45). Registering an importer for `.patterc` made Godot treat the file as
# an imported RESOURCE: `res://game.patterc` then resolves to `.godot/imported/game-<hash>.tres` and
# the source file is no longer shipped in an export. Every project loads a bundle with
# `FileAccess.get_file_as_string("res://...patterc")`, so exported builds stopped finding their
# bundle - and the usual fix, adding `*.patterc` to "filters to export non-resource files", cannot
# help, because the file had stopped being a non-resource. That reached users in 0.4.3.
#
# It worked in the editor, where the source file is still on disk, which is exactly why it passed
# every check here: nothing in this repo exports a project.
#
# The importer, the resource and the Inspector view are still in `editor/`, unregistered. Turning
# them back on needs an export-safe design (an EditorExportPlugin that puts the raw bundle back at
# its own path) and a REAL exported build to prove it, which is what was missing the first time.

const BundleImportPlugin := preload("res://addons/patterplay/editor/patter_bundle_import_plugin.gd")
const BundleInspectorPlugin := preload("res://addons/patterplay/editor/patter_bundle_inspector_plugin.gd")

var _import_plugin: EditorImportPlugin
var _inspector_plugin: EditorInspectorPlugin


func _enter_tree() -> void:
	# Deliberately not registered - see the note above. The inspector goes with it: without the
	# importer nothing produces a PatterBundleResource for it to draw.
	pass


func _exit_tree() -> void:
	if _import_plugin != null:
		remove_import_plugin(_import_plugin)
		_import_plugin = null
	if _inspector_plugin != null:
		remove_inspector_plugin(_inspector_plugin)
		_inspector_plugin = null
