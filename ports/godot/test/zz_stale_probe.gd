@tool
extends SceneTree
const PLUGIN := preload("res://addons/patterplay/patterplay_plugin.gd")
func _initialize() -> void:
	var p = PLUGIN.new()
	var stale = p._find_stale_imports("res://")
	print("stale sidecars found: ", stale.size(), " -> ", stale)
	quit(0)
