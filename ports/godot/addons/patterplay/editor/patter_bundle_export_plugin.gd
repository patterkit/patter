@tool
# The bundle export plugin: a thin subclass of the SHARED implementation.
#
# The logic, and the reasoning for it, live once in
# expr/ports/godot/bundle_export_plugin.gd, vendored beside the runtime as
# expr/bundle_export_plugin.gd. This file supplies only what differs between the
# two addons: a name, an extension and a label.
#
# It is shared because this exact pairing shipped broken here in 0.4.3 (#45),
# was fixed, and then had to be fixed a second time by hand in the Storylet
# Engine, which had the same importer and the same bug waiting for its first
# export. See the shared source for the full account.
extends "res://addons/patterplay/runtime/expr/bundle_export_plugin.gd"


func _init() -> void:
	plugin_name = "PatterplayBundleExport"
	bundle_extension = ".patterc"
	addon_label = "Patterplay"
