# PatterRunner: the flow API turned from pull to push, as the JS reference's runner tests pin it. Each
# delivered beat waits for next(), a choice for choose(), and the end emits `ended` with its reason
# ("ran-dry" or "ended"); handlers that call next() themselves don't deepen the stack; stop() drops what
# was asked for and leaves the flow where it is; a later begin(scene) moves the same flow, keeping the
# playthrough; rebind() plays on after a hot swap. Where GDScript can't throw, a refusal is kept for
# last_error() and delivers nothing.
#
#   godot --headless --path ports/godot --script res://test/test_runner.gd
extends SceneTree

var _fails := 0
var _runners: Array = []


func _bundle() -> Dictionary:
	var choice_opt := func(id: String, prompt: String, line_id: String) -> Dictionary:
		return {"id": id, "type": "group", "prompt": {"id": prompt, "kind": "text"}, "children": [
			{"id": "sn_" + id, "type": "snippet", "beats": [{"id": line_id, "kind": "line", "character": "NPC"}], "jump": {"to": "END"}}]}
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"cast": [{"name": "NPC"}],
		"strings": {"en": {"L1": "Hello.", "T1": "A door creaks.", "C_a": "Ask.", "C_b": "Leave.",
			"L_a": "Asked.", "L_b": "Bye.", "L_s": "Welcome."}},
		"scenes": {
			"talk": {"id": "talk", "gameId": "talk", "blocks": [{"id": "b1", "gameId": "b1", "children": [
				{"id": "sn1", "type": "snippet", "beats": [
					{"id": "L1", "kind": "line", "character": "NPC"},
					{"id": "T1", "kind": "text"},
					{"id": "E1", "kind": "gameEvent"},
				]},
				{"id": "grp", "type": "group", "selector": "choice", "children": [
					choice_opt.call("opt_a", "C_a", "L_a"),
					choice_opt.call("opt_b", "C_b", "L_b"),
				]},
			]}]},
			"shop": {"id": "shop", "gameId": "shop", "blocks": [{"id": "b2", "gameId": "b2", "children": [
				{"id": "sn_s", "type": "snippet", "beats": [{"id": "L_s", "kind": "line", "character": "NPC"}], "jump": {"to": "END"}},
			]}]},
		},
	}


func _runner(engine: PatterEngine) -> PatterRunner:
	var runner := PatterRunner.new()
	runner.attach(engine)
	_runners.append(runner)
	return runner


## A runner whose every signal is written down as `kind:id`.
func _recorded(engine: PatterEngine = null) -> Dictionary:
	if engine == null:
		engine = PatterEngine.new(_bundle())
	var runner := _runner(engine)
	var seen: Array = []
	runner.line.connect(func(s): seen.append("line:" + s["id"]))
	runner.text.connect(func(s): seen.append("text:" + s["id"]))
	runner.game_event.connect(func(s): seen.append("gameEvent:" + s["id"]))
	runner.choice.connect(func(c): seen.append("choice:" + ",".join((c["options"] as Array).map(func(o): return o["id"]))))
	runner.ended.connect(func(reason: String): seen.append("ended" if reason == "ended" else "ended:" + reason))
	return {"runner": runner, "seen": seen, "engine": engine}


func _initialize() -> void:
	_check_one_beat_per_next()
	_check_step_itself()
	_check_first_scene()
	_check_handlers_drive()
	_check_stop()
	_check_later_start_moves()
	_check_restart()
	_check_bad_address()
	_check_before_start()
	_check_bad_choose()
	_check_load_and_rebind()
	_check_ran_dry()
	_check_disconnect()
	for r in _runners:
		r.free()
	print("test_runner: ALL PASS" if _fails == 0 else "test_runner: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


func _check_one_beat_per_next() -> void:
	var r := _recorded()
	var runner: PatterRunner = r["runner"]
	var seen: Array = r["seen"]
	runner.begin("talk")
	_expect(seen == ["line:L1"], "begin() delivers the first beat: " + str(seen))
	runner.next()
	runner.next()
	_expect(seen == ["line:L1", "text:T1", "gameEvent:E1"], "one beat per next(), a game event included: " + str(seen))
	runner.next()
	_expect(seen[-1] == "choice:opt_a,opt_b", "then the choice: " + str(seen))
	runner.choose("opt_b")
	_expect(seen[-1] == "line:L_b", "choose() delivers what it leads to: " + str(seen))
	runner.next()
	_expect(seen[-1] == "ended", "then the end: " + str(seen))


func _check_step_itself() -> void:
	var runner := _runner(PatterEngine.new(_bundle()))
	var got := {"text": ""}
	runner.line.connect(func(s): got["text"] = "%s: %s" % [s["speakerLabel"], s["text"]])
	runner.begin("talk")
	_expect(got["text"] == "NPC: Hello.", "each signal carries the step itself: " + got["text"])


func _check_first_scene() -> void:
	var r := _recorded()
	(r["runner"] as PatterRunner).begin()
	_expect(r["seen"] == ["line:L1"], "begin() with no address starts at the first scene: " + str(r["seen"]))


func _check_handlers_drive() -> void:
	var runner := _runner(PatterEngine.new(_bundle()))
	var seen: Array = []
	var depth := {"now": 0, "deepest": 0}
	var step := func(id: String) -> void:
		depth["now"] += 1
		depth["deepest"] = maxi(depth["deepest"], depth["now"])
		seen.append(id)
		runner.next()
		depth["now"] -= 1
	runner.line.connect(func(s): step.call(s["id"]))
	runner.text.connect(func(s): step.call(s["id"]))
	runner.game_event.connect(func(s): step.call(s["id"]))
	runner.choice.connect(func(_c): runner.choose("opt_a"))
	runner.ended.connect(func(_reason): seen.append("ended"))
	runner.begin("talk")
	_expect(seen == ["L1", "T1", "E1", "L_a", "ended"], "handlers that call next() play the whole run: " + str(seen))
	_expect(depth["deepest"] == 1, "without deepening the stack: " + str(depth["deepest"]))


func _check_stop() -> void:
	var runner := _runner(PatterEngine.new(_bundle()))
	var seen: Array = []
	runner.line.connect(func(s):
		seen.append(s["id"])
		runner.next()
		runner.stop())
	runner.text.connect(func(s): seen.append(s["id"]))
	runner.ended.connect(func(_reason): seen.append("ended"))
	runner.begin("talk")
	_expect(seen == ["L1"], "stop() drops a next() a handler asked for: " + str(seen))
	_expect(not runner.get_flow().is_ended(), "and leaves the flow where it is, unended")
	runner.next()
	_expect(seen == ["L1", "T1"], "next() carries on from there: " + str(seen))


func _check_later_start_moves() -> void:
	var r := _recorded()
	var runner: PatterRunner = r["runner"]
	var engine: PatterEngine = r["engine"]
	runner.begin("talk")
	var flow := engine.get_flow("main")
	runner.begin("shop")
	_expect(engine.get_flow("main") == flow, "a later begin(scene) moves the same flow")
	_expect(r["seen"][-1] == "line:L_s", "and delivers the new scene's first beat: " + str(r["seen"]))
	_expect(flow.get_visit_counts().get("talk") == 1, "keeping its visit counts: " + str(flow.get_visit_counts()))


func _check_restart() -> void:
	var r := _recorded()
	var runner: PatterRunner = r["runner"]
	runner.begin("shop")
	runner.begin()
	_expect(r["seen"] == ["line:L_s", "line:L1"], "begin() on an open flow begins the story again: " + str(r["seen"]))
	runner.begin("", "b2")
	_expect(runner.last_error().contains("a block needs its scene"), "a block without its scene is refused: " + runner.last_error())
	_expect(r["seen"] == ["line:L_s", "line:L1"], "and delivers nothing: " + str(r["seen"]))


func _check_bad_address() -> void:
	var r := _recorded()
	var runner: PatterRunner = r["runner"]
	runner.begin("nowhere")
	_expect(runner.last_error().contains("address not found"), "a first begin() at a bad address is refused: " + runner.last_error())
	_expect(runner.get_flow() == null and r["seen"].is_empty(), "and opens nothing")
	runner.begin("talk")
	_expect(runner.last_error() == "", "a begin() that works clears the refusal: " + runner.last_error())
	runner.begin("nowhere")
	_expect(runner.last_error().contains("address not found"), "a later begin() at a bad address is refused: " + runner.last_error())
	runner.next()
	_expect(r["seen"] == ["line:L1", "text:T1"], "and leaves the flow as it was: " + str(r["seen"]))


func _check_before_start() -> void:
	var runner := _runner(PatterEngine.new(_bundle()))
	var seen: Array = []
	runner.ended.connect(func(_reason): seen.append("ended"))
	runner.next()
	_expect(runner.last_error().contains("begin() first"), "next() before begin() is refused: " + runner.last_error())
	runner.choose("opt_a")
	_expect(runner.last_error().contains("begin() first"), "choose() before begin() is refused: " + runner.last_error())
	_expect(seen.is_empty(), "and nothing is delivered: " + str(seen))


# Where the JS throws as flow.choose does, the refusal is kept for last_error() and nothing is delivered.
func _check_bad_choose() -> void:
	var r := _recorded()
	var runner: PatterRunner = r["runner"]
	runner.begin("talk")
	runner.choose("opt_a")
	_expect(runner.last_error() == "no choice is pending", "choose() with no choice pending is refused: " + runner.last_error())
	_expect(r["seen"] == ["line:L1"], "and delivers nothing: " + str(r["seen"]))
	runner.next()
	runner.next()
	runner.next()
	runner.choose("opt_z")
	_expect(runner.last_error() == "unknown choice option: opt_z", "an unknown option is refused: " + runner.last_error())
	_expect(r["seen"][-1] == "choice:opt_a,opt_b", "and delivers nothing: " + str(r["seen"]))
	runner.choose("opt_a")
	_expect(runner.last_error() == "" and r["seen"][-1] == "line:L_a", "a good choose() clears it and plays on: " + str(r["seen"]))


func _check_load_and_rebind() -> void:
	var r := _recorded()
	var runner: PatterRunner = r["runner"]
	var engine: PatterEngine = r["engine"]
	runner.begin("talk")
	runner.next()
	var save := engine.save_game()
	runner.next()
	engine.load_game(save)
	runner.next()
	_expect(r["seen"][-1] == "gameEvent:E1", "next() carries on after a load: " + str(r["seen"]))
	var swapped := engine.hot_swap(_bundle())
	runner.rebind(swapped)
	runner.next()
	_expect(r["seen"][-1] == "choice:opt_a,opt_b", "and after a hot swap once rebound: " + str(r["seen"]))


func _check_ran_dry() -> void:
	var hub := {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"cast": [{"name": "NPC"}],
		"strings": {"en": {"C_a": "Ask.", "L_a": "Asked."}},
		"scenes": {
			"hub": {"id": "hub", "gameId": "hub", "blocks": [{"id": "bh", "gameId": "bh", "children": [
				{"id": "g", "type": "group", "selector": "choice", "children": [
					{"id": "o", "type": "group", "prompt": {"id": "C_a", "kind": "text"}, "children": [
						{"id": "sn_o", "type": "snippet", "beats": [{"id": "L_a", "kind": "line", "character": "NPC"}], "jump": {"to": "hub"}}]},
				]},
			]}]},
		},
	}
	var r := _recorded(PatterEngine.new(hub))
	var runner: PatterRunner = r["runner"]
	runner.begin("hub")
	runner.choose("o")
	runner.next()   # back at the hub, its only option used: it runs dry, and nothing follows
	_expect(r["seen"] == ["choice:o", "line:L_a", "ended:ran-dry"],
		"`ended` carries the reason: ran-dry when a choice had nothing left and nothing came after it: " + str(r["seen"]))


func _check_disconnect() -> void:
	var runner := _runner(PatterEngine.new(_bundle()))
	var seen: Array = []
	var handler := func(s): seen.append(s["id"])
	runner.line.connect(handler)
	runner.line.disconnect(handler)
	runner.begin("talk")
	_expect(seen.is_empty(), "stops listening when asked: " + str(seen))


func _expect(ok: bool, what: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what)
