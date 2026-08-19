@tool
extends EditorPlugin

# The Patterplay runtime is plain GDScript (PatterEngine / PatterFlow / ...), usable with or
# without enabling this plugin. What the plugin adds is the EDITOR half: a .patterc imports as a
# PatterBundleResource, and selecting one shows the bundle inspector in the Inspector - the same
# summary Unity's CustomEditor and Unreal's details customisation draw.
#
# Deliberately not a dock. Storyletter shipped one and the first person to look at it double-clicked
# the bundle and looked at the Inspector instead, which is where the other engines put it.
#
# The runtime works with the plugin disabled: reading a .patterc with FileAccess and handing the
# Dictionary to PatterEngine is unchanged, and is still what the demo and the docs do.

const BundleImportPlugin := preload("res://addons/patterplay/editor/patter_bundle_import_plugin.gd")
const BundleInspectorPlugin := preload("res://addons/patterplay/editor/patter_bundle_inspector_plugin.gd")

var _import_plugin: EditorImportPlugin
var _inspector_plugin: EditorInspectorPlugin


func _enter_tree() -> void:
	_import_plugin = BundleImportPlugin.new()
	add_import_plugin(_import_plugin)
	_inspector_plugin = BundleInspectorPlugin.new()
	add_inspector_plugin(_inspector_plugin)


func _exit_tree() -> void:
	if _import_plugin != null:
		remove_import_plugin(_import_plugin)
		_import_plugin = null
	if _inspector_plugin != null:
		remove_inspector_plugin(_inspector_plugin)
		_inspector_plugin = null
