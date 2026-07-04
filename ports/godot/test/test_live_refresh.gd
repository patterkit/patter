# Headless check for live bundle refresh (apply_live_bundle): tier 1 (same structureHash -> the
# SAME engine with swapped strings) and tier 2 (changed structure -> a REPLACEMENT engine carrying
# the run). Run:
#   godot --headless --path ports/godot --script res://test/test_live_refresh.gd
extends SceneTree


func _initialize() -> void:
	var repo := ProjectSettings.globalize_path("res://").path_join("../..")
	var json := FileAccess.get_file_as_string(repo.path_join("examples/projects/patter-dist/tour.patterc"))
	if json == "":
		push_error("live refresh: tour bundle missing")
		quit(1)
		return

	var engine := PatterEngine.new(PatterBundle.load_from_string(json))
	var flow := engine.open_flow("main", "")
	flow.advance()  # play the first beat; the run is mid-flight

	# Tier 1: reword the guide's greeting (structureHash untouched) - the SAME engine plays the
	# new words on the next advance, position kept.
	var reworded: Dictionary = JSON.parse_string(json)
	reworded["strings"]["en"]["L_uk56f61b"] = "Reworded, live."
	var r1: Dictionary = engine.apply_live_bundle(JSON.stringify(reworded))
	if r1["kind"] != "text" or r1["engine"] != engine:
		push_error("live refresh: expected a tier-1 text swap on the same engine (got %s)" % str(r1["kind"]))
		quit(1)
		return
	var step: Dictionary = flow.advance()
	if step.get("text", "") != "Reworded, live.":
		push_error("live refresh: tier-1 swap did not surface the new text (got '%s')" % step.get("text", ""))
		quit(1)
		return

	# Tier 2: a changed structureHash forces the full swap - a REPLACEMENT engine, the flow
	# re-bound by id, and play continues from where it was.
	var restructured: Dictionary = JSON.parse_string(json)
	restructured["content"]["structureHash"] = "different"
	var r2: Dictionary = engine.apply_live_bundle(JSON.stringify(restructured))
	if r2["kind"] != "structure" or r2["engine"] == engine:
		push_error("live refresh: expected a tier-2 hot swap onto a replacement engine")
		quit(1)
		return
	var next_engine: PatterEngine = r2["engine"]
	var resumed := next_engine.get_flow("main")
	if resumed == null or resumed.advance().get("type", "") == "":
		push_error("live refresh: the run did not survive the hot swap")
		quit(1)
		return

	# Garbage never touches the engine.
	var r3: Dictionary = engine.apply_live_bundle("{ nope")
	if r3["kind"] != "error":
		push_error("live refresh: garbage json must report an error")
		quit(1)
		return

	print("live refresh: OK (text swap in place, structural swap carried the run, garbage rejected)")
	quit(0)
