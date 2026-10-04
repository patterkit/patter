# Rough timing for engine checkpoints (maintainers; informational, not a gate).
#
#   godot --headless --path ports/godot --script res://test/bench_checkpoint.gd
#
# A flow walks a block of ~10,000 snippets first, so it carries a long visit history, then barks
# (goto + advance) N times: plain, inside checkpoint + rollback, and inside checkpoint + commit. A
# checkpoint records only what a step changes, so its cost must not grow with that history.
extends SceneTree

const HISTORY := 10000


func _initialize() -> void:
	var bundle := _bundle()
	for n in [1000, 10000]:
		print("history %d visited nodes, %d barks:" % [HISTORY, n])
		print("  plain                 %s" % _fmt(_run(bundle, n, "")))
		print("  checkpoint + rollback %s" % _fmt(_run(bundle, n, "rollback")))
		print("  checkpoint + commit   %s" % _fmt(_run(bundle, n, "commit")))
	quit(0)


func _fmt(us: float) -> String:
	return "%.2f us per bark" % us


## Microseconds per bark over `n` barks, after building the history.
func _run(bundle: Dictionary, n: int, mode: String) -> float:
	var engine := PatterEngine.new(bundle, {"seed": 7})
	var flow := engine.open_flow("f", "s", "b_hist")
	while flow.advance()["type"] != "end":
		pass
	var t0 := Time.get_ticks_usec()
	for i in n:
		var cp = engine.checkpoint() if mode != "" else null
		flow.goto("s", "b_bark")
		flow.advance()
		if mode == "rollback":
			engine.rollback(cp)
		elif mode == "commit":
			engine.commit(cp)
	return float(Time.get_ticks_usec() - t0) / float(n)


func _bundle() -> Dictionary:
	var hist: Array = []
	for i in HISTORY:
		hist.append({"id": "sn_%d" % i, "type": "snippet", "beats": [{"id": "H%d" % i, "kind": "text"}]})
	return {
		"locales": {"default": "en"},
		"strings": {"en": {"B": "bark"}},
		"properties": [],
		"scenes": {"s": {"id": "s", "type": "scene", "name": "S", "blocks": [
			{"id": "b_hist", "type": "block", "name": "Hist", "children": hist},
			{"id": "b_bark", "type": "block", "name": "Bark", "children": [
				{"id": "sn_bark", "type": "snippet", "beats": [{"id": "B", "kind": "text"}], "jump": {"to": "END"}},
			]},
		]}},
	}
