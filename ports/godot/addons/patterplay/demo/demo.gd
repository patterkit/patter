# Patterplay Godot demo: load the compiled demo bundle and play the flow, printing each step.
# Run headless:  godot --headless --path ports/godot --script res://addons/patterplay/demo/demo.gd
extends SceneTree


func _initialize() -> void:
	var json := FileAccess.get_file_as_string("res://addons/patterplay/demo/demo.patterc")
	var bundle = PatterBundle.load_from_string(json)
	if bundle == null:
		quit(1)
		return

	var engine := PatterEngine.new(bundle)
	var flow := engine.open_flow("main", "demo")

	for i in 100:
		var step := flow.advance()
		match step["type"]:
			"line":
				var speaker = step.get("characterName", step.get("character", ""))
				print("%s: %s" % [speaker, step["text"]])
			"text":
				print(step["text"])
			"choice":
				if not step["options"].is_empty():
					print("> %s" % step["options"][0].get("text", ""))
					flow.choose(step["options"][0]["id"])
			"end":
				print("[end]  @gold = %s" % str(engine.get_property("@gold")))
				quit()
				return
	quit()
