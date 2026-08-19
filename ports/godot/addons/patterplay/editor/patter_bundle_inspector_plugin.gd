@tool
extends EditorInspectorPlugin

# The bundle inspector, Godot idiom (design/from-storylets/patterplay-bundle-inspector.md).
#
# The true analogue of Unity's [CustomEditor(typeof(PatterBundleAsset))] and Unreal's UPatterBundle
# details customisation: the callable-surface summary appears in the Inspector for the bundle you
# selected, so "select the asset, see the asset" holds in all three engines.
#
# Explicitly NOT a dock. Storyletter shipped one first and the first human to look at it
# double-clicked the bundle and looked at the Inspector, which is where the other two engines put it.
#
# Read-only, and cheap: the rows are built once per selection, not per repaint.

const BundleView := preload("res://addons/patterplay/editor/patter_bundle_view.gd")


func _can_handle(object: Object) -> bool:
	return object is PatterBundleResource


func _parse_begin(object: Object) -> void:
	var view: Control = BundleView.new()
	view.set_bundle_resource(object as PatterBundleResource)
	add_custom_control(view)
