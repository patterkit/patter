# The corpus TestHost: load corpus.json and replay every section through the GDScript Patterplay
# runtime, asserting the same results the JS reference produces - the port's half of the parity
# contract.
#
#   godot --headless --path ports/godot --script res://test/test_corpus.gd -- <abs path to corpus.json>
extends SceneTree

var _fails := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var path := args[0] if args.size() > 0 else "corpus.json"
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("corpus not found: " + path)
		quit(2)
		return
	var root = JSON.parse_string(text)
	if typeof(root) != TYPE_DICTIONARY:
		push_error("corpus is not valid JSON")
		quit(2)
		return

	var e := _run_expressions(root["expressions"])
	var sp := _run_specificity(root.get("specificity", []))
	var r := _run_runtime(root["runtime"])
	var s := _run_scripted(root["scripted"])
	var g := _run_gamedata(root["gameData"])

	print("expressions: %d  specificity: %d  runtime: %d  scripted: %d  gameData: %d" % [e, sp, r, s, g])
	print("ALL PASS" if _fails == 0 else ("%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)


func _fail(section: String, name: String, detail: String) -> void:
	_fails += 1
	push_error("  FAIL [%s] %s: %s" % [section, name, detail])


# -- expressions ---------------------------------------------------------------

func _run_expressions(arr: Array) -> int:
	var pass_count := 0
	for c in arr:
		var name: String = c["name"]
		var bags := {}
		for scope in c["scopes"].keys():
			var bag := {}
			for prop in c["scopes"][scope].keys():
				bag[prop] = PatterValues.to_value(c["scopes"][scope][prop])
			bags[scope] = bag
		var ctx := {"scopes": {}}
		for token in bags.keys():
			var bag: Dictionary = bags[token]
			ctx["scopes"][token] = func(n): return bag.get(n)
		if c.has("seed"):
			var rng := Mulberry32.new(int(c["seed"]))
			ctx["next_random"] = func(): return rng.next()
		var actual = PatterExpr.evaluate(c["ast"], ctx)
		var expected = PatterValues.to_value(c["expected"])
		if PatterValues.value_equals(actual, expected):
			pass_count += 1
		else:
			_fail("expr", name, "expected %s, got %s" % [str(expected), str(actual)])
	return pass_count


# -- specificity ---------------------------------------------------------------

func _run_specificity(arr: Array) -> int:
	var pass_count := 0
	for c in arr:
		var name: String = c["name"]
		var ctx := {"scopes": {}}
		for scope in c["scopes"].keys():
			var bag := {}
			for prop in c["scopes"][scope].keys():
				bag[prop] = PatterValues.to_value(c["scopes"][scope][prop])
			ctx["scopes"][scope] = func(n): return bag.get(n)
		var actual := PatterFlow._matched_spec(c["ast"], ctx, true)
		var expected := int(c["expected"])
		if actual == expected:
			pass_count += 1
		else:
			_fail("spec", name, "expected %d, got %d" % [expected, actual])
	return pass_count


# -- runtime -------------------------------------------------------------------

func _run_runtime(arr: Array) -> int:
	var pass_count := 0
	for c in arr:
		var name: String = c["name"]
		var options := {}
		if c.has("seed"):
			var rng := Mulberry32.new(int(c["seed"]))
			options["rng"] = func(): return rng.next()
		if c.has("locale"):
			options["locale"] = c["locale"]
		var engine := PatterEngine.new(c["bundle"], options)
		var start: Dictionary = c.get("start", {})
		var flow := engine.open_flow("main", start.get("scene", ""), start.get("block", ""))
		var scripted: Array = (c.get("choices", []) as Array).duplicate()
		var transcript: Array = []
		for i in 1000:
			var step := flow.advance()
			transcript.append(step)
			if step["type"] == "end":
				break
			if step["type"] == "choice":
				var pick := ""
				if not scripted.is_empty():
					pick = scripted.pop_front()
				else:
					for o in step["options"]:
						if o["eligible"]:
							pick = o["id"]
							break
				if pick == "":
					break
				flow.choose(pick)
		if _deep_equal(transcript, c["expectedTranscript"]):
			pass_count += 1
		else:
			_fail("runtime", name, "transcript mismatch\n    expected %s\n    got      %s" % [JSON.stringify(c["expectedTranscript"]), JSON.stringify(transcript)])
	return pass_count


# -- scripted ------------------------------------------------------------------

func _run_scripted(arr: Array) -> int:
	var pass_count := 0
	for c in arr:
		var name: String = c["name"]
		var options := {}
		if c.has("seed"):
			options["seed"] = int(c["seed"])
		var engine := PatterEngine.new(c["bundle"], options)
		var current := ""
		var ok := true
		for op in c["script"]:
			var chunk: Array = []
			var kind: String = op["op"]
			match kind:
				"openFlow":
					engine.open_flow(op["flow"], op.get("scene", ""), op.get("block", ""), op.get("seed"))
					current = op["flow"]
				"useFlow":
					current = op["flow"]
				"advance":
					chunk.append(engine.get_flow(current).advance())
				"choose":
					engine.get_flow(current).choose(op["id"])
				"goto":
					# Host navigation by address. No transcript of its own; the next advance shows where
					# it landed. expectResult pins the returned bool.
					var moved: bool = engine.get_flow(current).goto(op["scene"], op.get("block", ""))
					if op.has("expectResult") and moved != bool(op["expectResult"]):
						push_error("goto %s: expected %s, got %s" % [op["scene"], op["expectResult"], moved])
						return false
				"saveLoad":
					var blob := engine.save_game()
					engine = PatterEngine.new(c["bundle"], options)
					engine.load_game(blob)
				"hotSwap":
					# Live bundle refresh (spec 9.8): the whole game carried onto the EDITED bundle.
					var swap_blob := engine.save_game()
					engine = PatterEngine.new(c["bundleB"], options)
					engine.load_game(swap_blob)
				"setLocale":
					engine.set_locale(op["locale"])
				"setClosedCaptions":
					engine.set_closed_captions(op["on"])
				"reset":
					engine.reset()
					current = ""
			var expected = op.get("expect", null)
			var matched := _deep_equal(chunk, expected) if expected != null else chunk.is_empty()
			if not matched:
				ok = false
				_fail("scripted", name, "op %s: mismatch (got %s)" % [kind, JSON.stringify(chunk)])
				break
		if ok:
			pass_count += 1
	return pass_count


# -- gameData ------------------------------------------------------------------

func _run_gamedata(arr: Array) -> int:
	var pass_count := 0
	for c in arr:
		var name: String = c["name"]
		var node = c.get("node")
		var effective := PatterBundle.effective_game_data(PatterBundle.game_data_fields_for(c["bundle"], c["kind"]), node)
		if _deep_equal(effective, c["expected"]):
			pass_count += 1
		else:
			_fail("gameData", name, "expected %s, got %s" % [JSON.stringify(c["expected"]), JSON.stringify(effective)])
	return pass_count


# -- structural compare (produced floats vs expected JSON ints both ok) --------

func _deep_equal(a, b) -> bool:
	var ta := typeof(a)
	var tb := typeof(b)
	if (ta == TYPE_INT or ta == TYPE_FLOAT) and (tb == TYPE_INT or tb == TYPE_FLOAT):
		return float(a) == float(b)
	if ta != tb:
		return false
	match ta:
		TYPE_DICTIONARY:
			if a.size() != b.size():
				return false
			for k in a.keys():
				if not b.has(k) or not _deep_equal(a[k], b[k]):
					return false
			return true
		TYPE_ARRAY:
			if a.size() != b.size():
				return false
			for i in a.size():
				if not _deep_equal(a[i], b[i]):
					return false
			return true
	return a == b
