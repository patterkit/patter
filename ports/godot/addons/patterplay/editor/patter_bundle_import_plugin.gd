@tool
# The bundle import plugin: a thin subclass of the SHARED implementation.
#
# The import flow lives once in expr/ports/godot/bundle_import_plugin.gd,
# vendored beside the runtime as expr/bundle_import_plugin.gd. This file
# supplies only what differs: four names and the Resource type.
#
# It pairs with patter_bundle_export_plugin.gd, and they are shared together:
# importing is what changes the shipped bytes, which is exactly how #45
# happened.
extends "res://addons/patterplay/runtime/expr/bundle_import_plugin.gd"


func _init() -> void:
	importer_name = "patterplay.bundle"
	visible_name = "Patter Bundle"
	bundle_extension = "patterc"
	log_prefix = "PatterBundleImportPlugin"


func _make_resource() -> Resource:
	return PatterBundleResource.new()
