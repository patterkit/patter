# A flow's lifetime, headless: a flow the game has let go of is FREED, and so is everything it made.
#
# Flows, engines, and property bags are RefCounted, so a reference cycle among them is never
# collected. One was there for the life of the port: the flow's expression context held lambdas that
# read the flow's own members, and a GDScript lambda that reads a member holds its object strongly,
# so every flow ever opened (and its bags) stayed in memory, closed or not, and Godot reported about
# 14 leaked instances per flow at exit. Each case below drops every reference the test holds and
# then asks a weakref whether the object is gone.
#
#   godot --headless --path ports/godot --script res://test/test_flow_lifetime.gd
extends SceneTree

var _fails := 0


func _bundle() -> Dictionary:
	# Enough to reach every part of a flow that holds anything: a not-shared @patter global (the flow's
	# own bag), shared and per-flow @scene props (a stage bag and the flow's scene bag), conditions that
	# read both scopes, a seeded shuffle (the PRNG and selector state), interpolation, and a choice.
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"T1": "{@mine} and {@scene.tally}", "T2": "two", "T3": "three",
			"S1": "one", "S2": "other", "C_a": "Ask", "C_b": "Leave", "T_a": "asked"}},
		"properties": [
			{"name": "mine", "type": "number", "default": 1, "shared": false},
			{"name": "gold", "type": "number", "default": 0, "shared": true},
		],
		"scenes": {"s": {"id": "s", "gameId": "s",
			"sceneProps": [{"name": "tally", "type": "number", "default": 2, "shared": true},
				{"name": "seen", "type": "boolean", "default": false}],
			"blocks": [{"id": "b", "gameId": "b", "children": [
				{"id": "sn1", "type": "snippet", "condition": {"src": "@mine > 0", "ast": ["bin", ">", ["sv", "patter", "mine"], ["n", 0]]},
					"beats": [{"id": "T1", "kind": "text"}],
					"onExit": [{"kind": "set", "target": "@scene.seen", "value": {"src": "true", "ast": ["b", true]}}]},
				{"id": "g_sh", "type": "group", "selector": "sequence", "options": {"order": "shuffle", "exhaust": "repeat"}, "children": [
					{"id": "o1", "type": "snippet", "beats": [{"id": "S1", "kind": "text"}]},
					{"id": "o2", "type": "snippet", "beats": [{"id": "S2", "kind": "text"}]},
				]},
				{"id": "g", "type": "group", "selector": "choice", "children": [
					{"id": "a", "type": "group", "prompt": {"id": "C_a", "kind": "text"}, "children": [
						{"id": "a_c", "type": "snippet", "beats": [{"id": "T_a", "kind": "text"}], "jump": {"to": "END"}}]},
					{"id": "z", "type": "group", "condition": {"src": "@scene.seen", "ast": ["sv", "scene", "seen"]},
						"prompt": {"id": "C_b", "kind": "text"}, "children": [
						{"id": "z_c", "type": "snippet", "jump": {"to": "END"}}]},
				]},
			]}]}},
	}


func _initialize() -> void:
	var baseline := _object_count()

	_check_closed_flow_is_freed()
	_check_dropped_engine_frees_its_flows()
	_check_replaced_flow_is_freed()
	_check_refused_open_keeps_and_frees()
	_check_checkpoint_flows_are_freed()
	_check_save_load_and_hot_swap_free_the_old()
	_check_run_flow_and_log()

	# Everything every case made has gone: the object count is back where it started. This is what
	# Godot's "ObjectDB instances leaked at exit" counts, asserted here rather than read off stderr.
	var after := _object_count()
	_expect(after == baseline, "an engine with flows leaves no objects behind (%d before, %d after)" % [baseline, after])

	print("test_flow_lifetime: %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(1 if _fails > 0 else 0)


# Open, play into a choice, close, drop: the flow and every bag it registered are freed, while the
# engine is still alive.
func _check_closed_flow_is_freed() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7})
	var flow := engine.open_flow("main", "s")
	_play_to_choice(flow)
	var refs := _weak_parts(flow)
	engine.close_flow("main")
	flow = null
	_expect_freed(refs, "a closed flow")
	_expect(engine.flows().is_empty(), "the closed flow left the engine")


# Never closed: the engine going is what lets its flows go.
func _check_dropped_engine_frees_its_flows() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7})
	var one := engine.open_flow("one", "s")
	var two := engine.open_flow("two", "s")
	_play_to_choice(one)
	_play_to_choice(two)
	var refs := _weak_parts(one) + _weak_parts(two)
	refs.append(weakref(engine))
	one = null
	two = null
	engine = null
	_expect_freed(refs, "an engine and its open flows, dropped together")


# Re-opening a name closes the old flow; once the host lets go of it, it is freed.
func _check_replaced_flow_is_freed() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7})
	var old := engine.open_flow("main", "s")
	_play_to_choice(old)
	var refs := _weak_parts(old)
	var fresh := engine.open_flow("main", "s")
	_expect(old.is_closed() and not fresh.is_closed(), "the replaced flow is closed, the new one open")
	old = null
	_expect_freed(refs, "a replaced flow")
	fresh = null


# A refused open opens nothing and keeps the flow already there; dropping the engine frees both.
func _check_refused_open_keeps_and_frees() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7})
	var flow := engine.open_flow("main", "s")
	var refs := _weak_parts(flow)
	# These two push_error by design: the address does not resolve.
	_expect(engine.open_flow("main", "nowhere") == null, "an unknown scene is refused")
	_expect(engine.open_flow("other", "s", "no-such-block") == null, "an unknown block is refused")
	_expect(engine.get_flow("main") == flow and not flow.is_closed(), "the refused open left the open flow as it was")
	_expect(engine.get_flow("other") == null, "and opened nothing under a new name")
	refs.append(weakref(engine))
	flow = null
	engine = null
	_expect_freed(refs, "an engine after refused opens")


# A checkpoint's journal records flows, and a rollback closes a flow opened inside it: neither may
# keep a flow alive once the checkpoint is over.
func _check_checkpoint_flows_are_freed() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7})
	var kept := engine.open_flow("kept", "s")
	var cp = engine.checkpoint()
	kept.advance()
	var inside := engine.open_flow("inside", "s")
	_play_to_choice(inside)
	var refs := _weak_parts(inside)
	engine.rollback(cp)
	cp = null
	_expect(inside.is_closed(), "a rollback closes the flow opened inside the checkpoint")
	inside = null
	_expect_freed(refs, "a flow opened inside a rolled-back checkpoint")

	cp = engine.checkpoint()
	kept.advance()
	engine.commit(cp)
	cp = null
	refs = _weak_parts(kept)
	refs.append(weakref(engine))
	kept = null
	engine = null
	_expect_freed(refs, "an engine and a flow after a committed checkpoint")


# Loading into a fresh engine and hot-swapping both leave the old engine and its flows to be freed.
func _check_save_load_and_hot_swap_free_the_old() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7})
	var flow := engine.open_flow("main", "s")
	_play_to_choice(flow)
	var save: Dictionary = engine.save_game()
	var refs := _weak_parts(flow)
	refs.append(weakref(engine))
	flow = null
	var swapped := engine.hot_swap(_bundle())
	engine = null
	_expect(swapped.get_flow("main") != null, "the hot swap carried the flow over")
	_expect_freed(refs, "the engine a hot swap replaced, and its flow")

	var loaded := PatterEngine.new(_bundle(), {"seed": 7})
	_expect(loaded.load_game(save), "the save loads into a fresh engine")
	var restored := loaded.get_flow("main")
	_expect(restored.advance()["type"] == "choice", "the loaded flow is at its choice")
	refs = _weak_parts(restored) + _weak_parts(swapped.get_flow("main"))
	refs.append(weakref(loaded))
	refs.append(weakref(swapped))
	restored = null
	loaded = null
	swapped = null
	_expect_freed(refs, "a loaded engine and a hot-swapped one, and their flows")


# The one-call bark form, and an engine that logs: the log names flows, it must not hold them.
func _check_run_flow_and_log() -> void:
	var engine := PatterEngine.new(_bundle(), {"seed": 7, "log": true})
	var played: Array = engine.run_flow("bark", "s")
	_expect(not played.is_empty(), "run_flow played something")
	var flow := engine.get_flow("bark")
	flow.choose("a")
	flow.advance()
	_expect(not engine.log().is_empty(), "the engine logged")
	var refs := _weak_parts(flow)
	refs.append(weakref(engine))
	flow = null
	engine = null
	_expect_freed(refs, "a logging engine and a run_flow flow")


func _play_to_choice(flow: PatterFlow) -> void:
	for i in 10:
		if flow.advance()["type"] == "choice":
			return
	_expect(false, "the flow reached its choice")


## Weak references to a flow and every bag it holds (its own @patter half and its @scene bags).
func _weak_parts(flow: PatterFlow) -> Array:
	var out: Array = [weakref(flow)]
	for mount in flow.list_bags():
		out.append(weakref(mount["bag"]))
	return out


func _expect_freed(refs: Array, what: String) -> void:
	var alive := 0
	for r in refs:
		if (r as WeakRef).get_ref() != null:
			alive += 1
	_expect(alive == 0, "%s is freed (%d of %d objects still alive)" % [what, alive, refs.size()])


func _object_count() -> int:
	return int(Performance.get_monitor(Performance.OBJECT_COUNT))


func _expect(cond: bool, what: String) -> void:
	if not cond:
		_fails += 1
		printerr("  FAIL: %s" % what)
