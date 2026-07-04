# Headless smoke check for the tour demo scene: boot it, walk a few beats by pressing its own
# buttons, and prove the audio manifest resolves a real take. Run:
#   godot --headless --path ports/godot --script res://test/tour_check.gd
extends SceneTree

# Preloaded by path: the global class cache may be cold in a raw --script run.
const PatterAudioScript := preload("res://addons/patterplay/runtime/audio.gd")


func _initialize() -> void:
	var scene: PackedScene = load("res://addons/patterplay/demo/tour.tscn")
	var demo: Control = scene.instantiate()
	root.add_child(demo)
	await process_frame
	await process_frame

	var transcript: VBoxContainer = demo.get_node("Layout/Scroll/Transcript")
	var controls: VBoxContainer = demo.get_node("Layout/Controls")
	if transcript.get_child_count() == 0:
		push_error("tour demo: nothing played on boot (bundle missing?)")
		quit(1)
		return

	# Walk beats by pressing whatever single control is offered until the hub choice appears.
	var saw_choice := false
	for i in 40:
		await process_frame
		var buttons := controls.get_children()
		if buttons.is_empty():
			continue
		if buttons.size() > 1:
			saw_choice = true
			break
		(buttons[0] as Button).emit_signal("pressed")
	if not saw_choice:
		push_error("tour demo: never reached the hub choice")
		quit(1)
		return

	# The manifest must resolve a known tour take to a file that exists.
	var repo := ProjectSettings.globalize_path("res://").path_join("../..")
	var base := repo.path_join("examples/projects/audio")
	var manifest := FileAccess.get_file_as_string(base.path_join("patteraudio.json"))
	var audio = PatterAudioScript.new(manifest, base)
	var path: String = audio.resolve("L_uk56f61b")
	if path == "" or not FileAccess.file_exists(path):
		push_error("tour demo: audio manifest did not resolve L_uk56f61b to a real file (got '%s')" % path)
		quit(1)
		return

	print("tour demo: OK (%d beats played to the hub choice; audio resolves to %s)" % [transcript.get_child_count(), path.get_file()])
	demo.queue_free()  # tear the scene down cleanly so quit() doesn't report leaked instances
	await process_frame
	quit(0)
