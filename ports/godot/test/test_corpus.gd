# The corpus TestHost: load corpus.json and replay every section through the GDScript Patterplay
# runtime, asserting the same results the JS reference produces - the port's half of the parity
# contract.
#
#   godot --headless --path ports/godot --script res://test/test_corpus.gd -- <abs path to corpus.json>
extends SceneTree

var _fails := 0
var _dialect: Dictionary = PatterDialect.dialect()


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
	if not root.has("saves"):
		push_error("corpus has no saves section - a family the harness cannot run is a check that cannot fail")
		quit(2)
		return
	var sv := _run_saves(root["saves"])

	print("saves: %d/%d  (envelopes written by the JS reference, loaded here and continued)" % [sv, root["saves"].size()])
	_expect_all("saves", sv, root["saves"].size())
	_run_describe_smoke()

	print("expressions: %d/%d  specificity: %d/%d  runtime: %d/%d  scripted: %d/%d  gameData: %d/%d" % [
		e, root["expressions"].size(), sp, root.get("specificity", []).size(),
		r, root["runtime"].size(), s, root["scripted"].size(), g, root["gameData"].size()])

	# Every case must PASS, not merely not fail. Until 2026-09-01 this host printed
	# bare pass counts and exited on _fails alone, so a runner that died before its
	# loop reported "specificity: 0" and still said ALL PASS. That happened, during
	# the work that added the section below, and nothing caught it: the counts are
	# the check, so assert them.
	_expect_all("expressions", e, root["expressions"].size())
	_expect_all("specificity", sp, root.get("specificity", []).size())
	_expect_all("runtime", r, root["runtime"].size())
	_expect_all("scripted", s, root["scripted"].size())
	_expect_all("gameData", g, root["gameData"].size())

	# The expr parity corpus sits beside ours, vendored from ../expr. Absent is a
	# FAILURE, not a skip: a parity gate that quietly does nothing when its fixture
	# is missing is the shape of check this codebase has been bitten by.
	var expr_path := path.get_base_dir().path_join("expr-corpus.json")
	var expr_text := FileAccess.get_file_as_string(expr_path)
	if expr_text == "":
		push_error("expr parity corpus not found: " + expr_path)
		quit(2)
		return
	var expr_root = JSON.parse_string(expr_text)
	if not (expr_root is Dictionary):
		push_error("expr parity corpus is not valid JSON")
		quit(2)
		return
	var x_prng: Array = expr_root["prng"]
	var x_expr: Array = expr_root["expressions"]
	var xp := _run_expr_prng(x_prng)
	var xe_result := _run_expr_expressions(x_expr)
	var xe: int = xe_result[0]
	var unrunnable: int = xe_result[1]
	# A family the corpus carries and this harness does not run is a check that
	# cannot fail here, so a missing key is a failure, not a skip.
	if not expr_root.has("registry"):
		push_error("expr parity corpus has no registry family")
		quit(2)
		return
	var x_reg: Array = expr_root["registry"]
	var xr := _run_expr_registry(x_reg)
	_expect_all("expr/registry", xr, x_reg.size())
	print("expr corpus v%d - prng: %d/%d  expressions: %d/%d  registry: %d/%d" % [
		int(expr_root["version"]), xp, x_prng.size(), xe, x_expr.size() - unrunnable, xr, x_reg.size()])
	if unrunnable > 0:
		print("  GAP: %d expectError cases cannot run here - PatterExpr has no is_error();" % unrunnable)
		print("       it push_error()s and returns a fallback value, so a refusal is")
		print("       indistinguishable from an answer. See _run_expr_expressions.")

	print("ALL PASS" if _fails == 0 else ("%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)


# describeBundle: the bundle inspector's runtime half. Not a corpus case - it adds no runtime
# behaviour, so the corpus is untouched - but the numbers have to agree with the JS reference or two
# inspectors describe the same asset differently. Mirrors the fixture in the JS tests.
func _run_describe_smoke() -> void:
	var bundle := {
		"schema": "patter/bundle@0",
		"content": { "project": "Tavern", "version": "1.2.0", "hash": "abc", "structureHash": "def" },
		"locales": { "default": "en", "included": ["en", "fr"] },
		"properties": [{ "name": "gold", "type": "number", "default": 5 }],
		"scopeRegistry": { "version": 1, "scopes": [
			{ "token": "world", "declarations": [{ "name": "isnight", "type": "boolean", "default": true }] },
			{ "token": "game" },   # no declarations at all: OPAQUE, which an empty list is not
		] },
		"scenes": { "s1": {
			"id": "s1", "name": "Opening Night",
			"sceneProps": [{ "name": "seen", "type": "boolean" }],
			"blocks": [{ "id": "b1", "name": "The Bar", "children": [
				{ "id": "g1", "type": "group", "selector": "choice", "prompt": { "id": "P1", "kind": "text" },
				  "children": [{ "id": "opt1", "type": "snippet", "beats": [{ "id": "L1", "kind": "line" }] }] },
				{ "id": "sn", "type": "snippet", "beats": [{ "id": "E1", "kind": "gameEvent" }] },
			] }],
		} },
	}

	var d := PatterDescribe.describe_bundle(bundle)

	if d["identity"]["schema"] != "patter/bundle@0" or d["identity"]["project"] != "Tavern" or d["identity"]["version"] != "1.2.0":
		_fail("describe", "identity", "schema / project / version not carried")
	if d["identity"]["localisation"] != "embedded":
		_fail("describe", "identity", "absent localisation must read as embedded")
	if d["addresses"].size() != 1 or d["addresses"][0]["game_id"] != "opening-night" or d["addresses"][0]["name"] != "Opening Night":
		_fail("describe", "addresses", "scene address derived from the name")
	if d["addresses"][0]["blocks"].size() != 1 or d["addresses"][0]["blocks"][0]["game_id"] != "the-bar":
		_fail("describe", "addresses", "block address nested under its scene")
	if d["host_scopes"].size() != 2 or d["host_scopes"][0]["token"] != "world" or d["host_scopes"][0]["opaque"]:
		_fail("describe", "host_scopes", "declared scope")
	if not d["host_scopes"][1]["opaque"] or d["host_scopes"][1]["properties"].size() != 0:
		_fail("describe", "host_scopes", "a scope with no declarations is OPAQUE, not empty")
	if d["properties"]["patter"].size() != 1 or not d["properties"]["patter"][0]["shared"]:
		_fail("describe", "properties", "@patter defaults to shared")
	if d["properties"]["scene"].size() != 1 or d["properties"]["scene"][0]["properties"][0]["shared"]:
		_fail("describe", "properties", "@scene defaults to per-flow")
	# beats counts the population get_beat_sequence walks; the choice prompt is a SEPARATE row.
	var c: Dictionary = d["counts"]
	if c["scenes"] != 1 or c["blocks"] != 1 or c["groups"] != 1 or c["snippets"] != 2 \
		or c["beats"] != 2 or c["prompts"] != 1 or c["game_events"] != 1:
		_fail("describe", "counts", "scene/block/group/snippet/beat/prompt/gameEvent counts")


# A section that passed fewer cases than it holds has a runner that stopped early,
# which is invisible if only failures are counted.
func _expect_all(section: String, passed: int, total: int) -> void:
	if passed != total:
		_fail(section, "section total", "%d of %d cases passed; the runner did not finish" % [passed, total])


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
			var rng := PatterMulberry32.new(int(c["seed"]))
			ctx["next_random"] = func(): return rng.next()
		var actual = PatterExpr.evaluate(c["ast"], ctx, _dialect)
		var expected = PatterValues.to_value(c["expected"])
		if PatterValues.value_equals(actual, expected):
			pass_count += 1
		else:
			_fail("expr", name, "expected %s, got %s" % [str(expected), str(actual)])
	return pass_count



# -- the @wildwinter/expr parity corpus -------------------------------------------
#
# A SECOND corpus, authored in ../expr and vendored here, holding the primitives
# both product families share and neither family's own corpus tests: seed
# coercion, the PRNG draw and state sequence, operator typing, short-circuiting,
# value equality and the comparison rules.


# JSON has no literal for the non-finite doubles, and they are exactly the
# interesting coercion cases, so the corpus carries them as strings.
static func _expr_seed(v: Variant) -> float:
	if typeof(v) == TYPE_STRING:
		match v:
			"NaN": return NAN
			"Infinity": return INF
			"-Infinity": return -INF
	return float(v)


func _run_expr_prng(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var name: String = c["name"]
		var prng := PatterMulberry32.new(_expr_seed(c["seed"]))

		var want_seed := int(c["expectSeedState"])
		if prng.a != want_seed:
			_fail("expr/prng", name, "seed state %d, expected %d" % [prng.a, want_seed])
			continue

		var states: Array = c["expectStates"]
		var draws: Array = c["expectDraws"]
		var ok := true
		for i in states.size():
			var d := prng.next()
			# The corpus pins the draw's NUMERATOR, an exact uint32, so no port is
			# held to another language's float printing.
			var got_draw := int(round(d * 4294967296.0))
			if got_draw != int(draws[i]):
				_fail("expr/prng", name, "draw %d is %d, expected %d" % [i + 1, got_draw, int(draws[i])])
				ok = false
				break
			if prng.a != int(states[i]):
				_fail("expr/prng", name, "state after draw %d is %d, expected %d" % [i + 1, prng.a, int(states[i])])
				ok = false
				break
			if d < 0.0 or d >= 1.0:
				_fail("expr/prng", name, "draw %d is %f, outside [0, 1)" % [i + 1, d])
				ok = false
				break
		if ok:
			pass_count += 1
	return pass_count


# The expr corpus's expression cases. Same shape as ours, with one addition:
# `expectError` cases, which pin the TYPING contract - which operand combinations
# the evaluator must REFUSE.
#
# This port cannot run those yet. PatterExpr signals a bad expression with
# push_error() and then returns a FALLBACK VALUE (0.0 for a division by zero or a
# mixed-type `+`, false for an unknown operator), so a caller cannot tell a
# refusal from an answer, and neither can this runner. The other three Patterplay
# runtimes raise. Storylets' GDScript port solved this years-equivalent ago with an
# EvalError object and an is_error() predicate (runtime/expression.gd), which is the
# shape to copy.
#
# So the gap is COUNTED AND PRINTED on every run rather than skipped quietly, and
# the moment PatterExpr grows an is_error() the cases start running here with no
# change to this file.
func _run_expr_expressions(cases: Array) -> Array:
	var pass_count := 0
	var unrunnable := 0
	# Probed on an instance, and CALLED through call(): GDScript resolves a static
	# call at parse time, so naming PatterExpr.is_error() directly would be a parse
	# error today rather than a graceful gap. call() defers it to runtime, which is
	# what lets this file compile now and start running the cases the moment the
	# method lands.
	var expr_probe := PatterExpr.new()
	var can_detect_errors: bool = expr_probe.has_method("is_error")

	for c in cases:
		var name: String = c["name"]
		var expect_error: bool = c.get("expectError", false)
		if expect_error and not can_detect_errors:
			unrunnable += 1
			continue

		var ctx := {"scopes": {}}
		for token in c["scopes"].keys():
			var bag := {}
			for prop in c["scopes"][token].keys():
				bag[prop] = PatterValues.to_value(c["scopes"][token][prop])
			ctx["scopes"][token] = func(n): return bag.get(n)

		var actual = PatterExpr.evaluate(c["ast"], ctx, _dialect)
		if expect_error:
			if expr_probe.call("is_error", actual):
				pass_count += 1
			else:
				_fail("expr", name, "expected an eval error, got %s" % str(actual))
		elif can_detect_errors and expr_probe.call("is_error", actual):
			_fail("expr", name, "unexpected error: %s" % str(actual))
		else:
			var expected = PatterValues.to_value(c["expected"])
			if PatterValues.value_equals(actual, expected):
				pass_count += 1
			else:
				_fail("expr", name, "expected %s, got %s" % [str(expected), str(actual)])
	return [pass_count, unrunnable]


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
		var truthy := func(n: Array) -> bool:
			var v = PatterExpr.evaluate(n, ctx, _dialect)
			return false if PatterExpr.is_error(v) else PatterValues.truthy(v)
		var actual := PatterSpecificity.matched_specificity(c["ast"], truthy)
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
			var rng := PatterMulberry32.new(int(c["seed"]))
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
		var holder := {"engine": PatterEngine.new(c["bundle"], options)}
		if _run_script(holder, c["script"], c["bundle"], c.get("bundleB", {}), options, name):
			pass_count += 1
	return pass_count

## Run a script's ops against a LIVE engine held in `holder["engine"]` (saveLoad / hotSwap replace
## it, and GDScript passes objects by value). Shared by the scripted cases and the saves cases, whose
## engine arrives already loaded from an envelope another runtime wrote.
func _run_script(holder: Dictionary, ops: Array, bundle: Dictionary, bundle_b: Dictionary, options: Dictionary, name: String) -> bool:
	var current := ""
	var ok := true
	for op in ops:
		var chunk: Array = []
		var kind: String = op["op"]
		match kind:
			"openFlow":
				holder["engine"].open_flow(op["flow"], op.get("scene", ""), op.get("block", ""), op.get("seed"))
				current = op["flow"]
			"useFlow":
				current = op["flow"]
			"advance":
				chunk.append(holder["engine"].get_flow(current).advance())
			"choose":
				holder["engine"].get_flow(current).choose(op["id"])
			"goto":
				# Host navigation by address. No transcript of its own; the next advance shows where
				# it landed. expectResult pins the returned bool.
				var moved: bool = holder["engine"].get_flow(current).goto(op["scene"], op.get("block", ""))
				if op.has("expectResult") and moved != bool(op["expectResult"]):
					push_error("goto %s: expected %s, got %s" % [op["scene"], op["expectResult"], moved])
					return false
			"saveLoad":
				# Round-trip through the patter/save@0 envelope (runtime/save.gd), asserting the
				# flattened state survives - which exercises the StateLogger's snapshot/diff too
				# (parity brief B1/B2).
				var before := PatterStateLogger.snapshot_state(holder["engine"])
				var json := PatterSave.serialize_state(holder["engine"])
				holder["engine"] = PatterEngine.new(bundle, options)
				if not PatterSave.deserialize_state(holder["engine"], json):
					_fail("scripted", name, "envelope refused its own serialization")
				if not PatterStateLogger.diff_state(before, PatterStateLogger.snapshot_state(holder["engine"])).is_empty():
					_fail("scripted", name, "envelope round-trip changed flattened state")
			"hotSwap":
				# Live bundle refresh (spec 9.8): the whole game carried onto the EDITED bundle.
				var swap_blob: Dictionary = holder["engine"].save_game()
				holder["engine"] = PatterEngine.new(bundle_b, options)
				holder["engine"].load_game(swap_blob)
			"setLocale":
				holder["engine"].set_locale(op["locale"])
			"setClosedCaptions":
				holder["engine"].set_closed_captions(op["on"])
			"expectCast":
				# Static structure query: no transcript, expectResult pins the exact list INCLUDING
				# order. No scene = the declared project cast.
				var got: Array = []
				if not op.has("scene"):
					got = holder["engine"].get_cast()
				elif not op.has("block"):
					got = holder["engine"].cast_for_scene(op["scene"])
				else:
					got = holder["engine"].cast_for_block(op["scene"], op["block"])
				var want: Array = op["expectResult"]
				if not _deep_equal(got, want):
					ok = false
					_fail("scripted", name, "expectCast: expected %s, got %s" % [JSON.stringify(want), JSON.stringify(got)])
					break
			"reset":
				holder["engine"].reset()
				current = ""
		var expected = op.get("expect", null)
		var matched := _deep_equal(chunk, expected) if expected != null else chunk.is_empty()
		if not matched:
			ok = false
			_fail("scripted", name, "op %s: mismatch (got %s)" % [kind, JSON.stringify(chunk)])
			break
	return ok


# -- saves: an envelope the JS reference wrote, loaded through THIS addon's own boundary ------------

func _run_saves(arr: Array) -> int:
	var pass_count := 0
	for c in arr:
		var name: String = c["name"]
		var options := {}
		if c.has("seed"):
			options["seed"] = int(c["seed"])
		var holder := {"engine": PatterEngine.new(c["bundle"], options)}
		# Writer and reader are different runtimes here, which no self round-trip can test. Then the
		# addon must write the loaded state back in the same shape (key paths) before continuing.
		if not PatterSave.load_state(holder["engine"], c["envelope"]):
			_fail("saves", name, "the JS-written envelope was refused")
			continue
		var back: Dictionary = PatterSave.save_state(holder["engine"])
		var got: Array = _key_paths(back, "", [])
		var want: Array = c["keyPaths"]
		if got != want:
			var missing := want.filter(func(k): return not got.has(k))
			var extra := got.filter(func(k): return not want.has(k))
			_fail("saves", name, "re-serialised save has different key paths\n    missing: %s\n    extra: %s" % [str(missing), str(extra)])
			continue
		if _run_script(holder, c["script"], c["bundle"], {}, options, name):
			pass_count += 1
	return pass_count


## Every key path in a value, sorted by code unit: `save/flows/main/cursor/stack[0]/sceneId`.
## Containers included, array elements indexed, leaf types not recorded (shape, not values). The JS
## runner's envelopeKeyPaths is the reference for this walk.
func _key_paths(v, path: String, out: Array) -> Array:
	if v is Array:
		if path != "":
			out.append(path)
		var arr: Array = v
		for i in range(arr.size()):
			_key_paths(arr[i], "%s[%d]" % [path, i], out)
	elif v is Dictionary:
		if path != "":
			out.append(path)
		var d: Dictionary = v
		for k in d:
			_key_paths(d[k], ("%s/%s" % [path, k]) if path != "" else str(k), out)
	else:
		out.append(path)
	if path == "":
		out.sort()
	return out



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


# -- the expr parity corpus: registry ---------------------------------------------
#
# The scope kernel's `writable` rule: decl.writable ?? scope.writable ?? true.
#
# This port has no ScopeRegistry - Patterplay mounts its host scopes by hand - so a
# case with a "scope" is run by FOLDING the scope default into each declaration that
# says nothing of its own, then seeding the bag. The fold is the rule, written down
# once; what these nine cases pin here is the shared PropertyBag, which is the code
# that actually refuses. The value is read back on BOTH outcomes.
func _run_expr_registry(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var name: String = c["name"]
		var scope: Dictionary = c.get("scope", {})
		var decls: Array = []
		for d in c["declarations"]:
			var decl: Dictionary = (d as Dictionary).duplicate()
			decl["default"] = PatterValues.to_value(d["default"])
			if not decl.has("writable") and scope.has("writable"):
				decl["writable"] = scope["writable"]
			decls.append(decl)
		var set_name: String = c["set"]["name"]
		var value = PatterValues.to_value(c["set"]["value"])
		var expect_error: bool = c.get("expectError", false)
		var expected = PatterValues.to_value(c["expected"])

		var bag := PatterPropertyBag.new(decls)
		var change: Dictionary = bag.set_value(set_name, value)
		var error: String = str(change["error"]) if change.has("error") else ""
		var read_back = bag.get_value(set_name)

		var ok := true
		if expect_error:
			if error == "":
				_fail("expr/registry", name, "expected a read-only refusal, the write landed")
				ok = false
			elif not error.contains("is read-only"):
				_fail("expr/registry", name, "refused, but not as read-only: " + error)
				ok = false
		elif error != "":
			_fail("expr/registry", name, "unexpected refusal: " + error)
			ok = false
		if not PatterValues.value_equals(read_back, expected):
			_fail("expr/registry", name, "read back %s, expected %s" % [
				PatterValues.show(read_back), PatterValues.show(expected)])
			ok = false
		if ok:
			pass_count += 1
	return pass_count
