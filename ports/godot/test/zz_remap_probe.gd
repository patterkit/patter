@tool
extends SceneTree
func _initialize() -> void:
	var p := "res://addons/patterplay/demo/demo.patterc"
	print("FileAccess reads raw bytes: ", FileAccess.get_file_as_string(p).length(), " chars")
	print("ResourceLoader.exists(): ", ResourceLoader.exists(p))
	var remapped := ProjectSettings.localize_path(p)
	print("has .import sidecar on disk: ", FileAccess.file_exists(p + ".import"))
	var res = ResourceLoader.load(p) if ResourceLoader.exists(p) else null
	print("load() returned: ", res)
	quit(0)
