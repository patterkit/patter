# GENERATED - vendored from expr/ports/godot/testing/registry_corpus.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# The registry corpus runner, for Godot. THE SHARED SOURCE.
#
# Authored in expr/ports/godot/testing and VENDORED into each family's
# ports/godot/test by expr/scripts/vendor-ports.mjs. Test code: it never ships in an
# addon. Do not edit a vendored copy.
#
# A re-implementation of packages/scoperegistry/test/corpus/runner.ts, which is the
# NORMATIVE statement of what each step means: if this runner does something that one
# does not, this port is testing something else. It drives the family's registry
# (the class_name shim over the vendored scope_registry.gd) through every case of the
# registry corpus, the JSON every copy of the ScopeRegistry runs, and evaluates `eval`
# steps with the shared evaluator under the corpus dialect.
#
# NO `class_name`: two projects vendor this file, and a suite loads it by path.
#
#   const RegistryCorpus := preload("res://test/registry_corpus.gd")
#   var result := RegistryCorpus.run(path, StoryletScopeRegistry, StoryletPropertyBag,
#       preload("res://addons/storyletengine/runtime/expr/expr_eval.gd"))
#
# `run` returns {"cases": int, "passed": int, "failures": Array[String]}. A corpus that
# is missing or unreadable is a FAILURE, never a skip: it comes back as one failure and
# no cases, so a suite that fails on any failure fails on it.
#
# GDScript has no exceptions, so the registry reports a refusal in its return value
# (see scope_registry.gd); `attempt` below reads those where runner.ts catches a throw.
# ---------------------------------------------------------------------------
extends RefCounted


## The dialect the corpus is compiled with (runner.ts corpusDialect): five scopes, a
## default scope, and no functions. A case exercises the registry's scope resolution
## and quality ladders, both of which the evaluator's core handles without a dialect.
const CORPUS_DIALECT := {
	"scopes": [{"token": "game"}, {"token": "world"}, {"token": "here"}, {"token": "a"}, {"token": "b"}],
	"default_scope": "game",
	"functions": {},
}


## The corpus's `normalise: "identity"`: names kept exactly as written.
static var IDENTITY := func(n: String) -> String: return n


## Run every case of the registry corpus at `corpus_path` against `registry_script`
## (the family's registry class), building mounted bags with `bag_script` (the family's
## bag class) and evaluating with `evaluator` (the shared expr_eval.gd).
static func run(corpus_path: String, registry_script: Script, bag_script: Script, evaluator: Script) -> Dictionary:
	var text := FileAccess.get_file_as_string(corpus_path)
	if text == "":
		return {"cases": 0, "passed": 0, "failures": ["registry corpus not found: " + corpus_path]}
	var root = JSON.parse_string(text)
	if not (root is Dictionary) or not (root.get("cases") is Array):
		return {"cases": 0, "passed": 0, "failures": ["registry corpus is not valid: " + corpus_path]}
	var cases: Array = root["cases"]
	if cases.is_empty():
		return {"cases": 0, "passed": 0, "failures": ["registry corpus has no cases: " + corpus_path]}
	var failures: Array[String] = []
	var passed := 0
	for c in cases:
		var result = run_case(c, registry_script, bag_script, evaluator)
		# A script error abandons run_case, which then hands back null: a case that
		# stopped half way must read as a failure, not as a case with nothing wrong.
		if not (result is Dictionary) or not result.get("finished", false):
			failures.append("%s: the case stopped on a script error before it finished (see SCRIPT ERROR above)" % str(c.get("name", "?")))
			continue
		var fails: Array = result["fails"]
		if fails.is_empty():
			passed += 1
		for f in fails:
			failures.append(str(f))
	return {"cases": cases.size(), "passed": passed, "failures": failures}


## One case: a fresh registry, then its steps in order. {"fails": Array, "finished": true}.
static func run_case(c: Dictionary, registry_script: Script, bag_script: Script, evaluator: Script) -> Dictionary:
	var fails: Array = []
	var r = registry_script.new()
	var stores := {}   # foreign token -> the plain Dictionary its resolver reads and writes
	var steps: Array = c["steps"]
	for i in steps.size():
		var step: Dictionary = steps[i]
		var op := str(step["op"])
		var at := "%s [step %d: %s]" % [c["name"], i + 1, op]
		var want = step.get("expectError")
		match op:
			"owned":
				var opts := {}
				if step.has("pathPrefix"):
					opts["path_prefix"] = step["pathPrefix"]
				if step.get("normalise") == "identity":
					opts["normalise"] = IDENTITY
				if step.has("owner"):
					opts["owner"] = step["owner"]
				_attempt(fails, at, want, r.define_owned(step["token"], _decls(step.get("declarations")), opts))

			"mount":
				var bag_opts := {}
				if step.has("pathPrefix"):
					bag_opts["path_prefix"] = step["pathPrefix"]
				if step.get("normalise") == "identity":
					bag_opts["normalise"] = IDENTITY
				var bag = bag_script.new(_decls(step.get("declarations")), bag_opts)
				var mount_opts := {}
				if step.has("owner"):
					mount_opts["owner"] = step["owner"]
				_attempt(fails, at, want, r.mount_owned(step["token"], bag, mount_opts))

			"foreign":
				var store: Dictionary = (step.get("store", {}) as Dictionary).duplicate(true)
				var resolver := {"get": func(n: String): return store.get(n)}
				if step.get("settable", true) != false:
					resolver["set"] = func(n: String, v) -> void: store[n] = v
				var opts := {}
				if step.has("writable"):
					opts["writable"] = step["writable"]
				if step.get("normalise") == "identity":
					opts["normalise"] = IDENTITY
				if step.has("owner"):
					opts["owner"] = step["owner"]
				if _attempt(fails, at, want, r.define_foreign(step["token"], resolver, _decls(step.get("declarations")), opts)):
					stores[step["token"]] = store

			"set":
				var opts := {"host": true} if step.get("host", false) == true else {}
				_attempt(fails, at, want, r.set_value(step["scope"], step["name"], step["value"], opts))

			"get":
				var got = r.get_value(step["scope"], step["name"])
				if step.get("expectUnset", false) == true:
					if got != null:
						fails.append("%s: expected unset, got %s" % [at, _show(got)])
				elif not same(got, step.get("expect")):
					fails.append("%s: got %s, expected %s" % [at, _show(got), _show(step.get("expect"))])

			"has":
				var expect := bool(step["expect"])
				if r.has(step["token"]) != expect:
					fails.append("%s: has('%s') is %s, expected %s" % [at, step["token"], str(not expect), str(expect)])

			"remove":
				var opts := {"keep": true} if step.get("keep", false) == true else {}
				_attempt(fails, at, want, r.remove(step["token"], opts))

			"save":
				var got = r.save()
				if not same(got, step["expect"]):
					fails.append("%s: saved %s, expected %s" % [at, _show(got), _show(step["expect"])])

			"load":
				var opts := {"keep_parked": true} if step.get("keepParked", false) == true else {}
				r.load((step["blob"] as Dictionary).duplicate(true), opts)

			"discardParked":
				r.discard_parked(str(step.get("prefix", "")))

			"revision":
				if not same(r.revision, step["expect"]):
					fails.append("%s: revision is %s, expected %s" % [at, _show(r.revision), _show(step["expect"])])

			"store":
				var got = stores.get(step["scope"])
				if not same(got, step["expect"]):
					fails.append("%s: the game's store holds %s, expected %s" % [at, _show(got), _show(step["expect"])])

			"rows":
				var got: Array = []
				for row in r.list_properties():
					var g := {"scope": row["scope"]}
					if row.has("owner"):
						g["owner"] = row["owner"]
					g["name"] = row["name"]
					g["path"] = row["path"]
					g["value"] = row["value"]
					g["writable"] = row["writable"]
					got.append(g)
				if not same(got, step["expect"]):
					fails.append("%s: rows %s, expected %s" % [at, _show(got), _show(step["expect"])])

			"eval":
				if not (step.get("ast") is Array):
					fails.append("%s: no compiled ast (the corpus was not built)" % at)
				else:
					var opts := {"aliases": step["aliases"]} if step.has("aliases") else {}
					var ctx: Dictionary = r.to_eval_context(null, opts)
					var err := ""
					var got = null
					if ctx.has("error"):
						err = str(ctx["error"])
					else:
						got = evaluator.evaluate(step["ast"], ctx, CORPUS_DIALECT)
						if evaluator.is_error(got):
							err = got.message
					if _attempt(fails, at, want, err) and want == null and not same(got, step.get("expect")):
						fails.append("%s: %s is %s, expected %s" % [at, step["src"], _show(got), _show(step.get("expect"))])

			"spec":
				var res: Dictionary = r.read_scope_registry_spec(step["source"])
				var err := "" if res.get("ok", false) else str(res.get("error", "refused without a message"))
				if _attempt(fails, at, want, err) and want == null:
					var spec = res.get("spec")
					if step.get("expectAbsent", false) == true:
						if spec != null:
							fails.append("%s: expected no spec, got one" % at)
					elif spec == null:
						fails.append("%s: expected a spec, got none" % at)
					else:
						var tokens: Array = []
						for s in spec["scopes"]:
							tokens.append(s["token"])
						var summary := {"version": spec["version"], "tokens": tokens}
						if not same(summary, step["expect"]):
							fails.append("%s: read %s, expected %s" % [at, _show(summary), _show(step["expect"])])

			_:
				fails.append("%s: unknown step op '%s' (the runner is older than the corpus)" % [at, op])
	return {"fails": fails, "finished": true}


## runner.ts attempt(): `err` is what the call reported ("" for success). With `want`,
## it must be a refusal whose message contains `want`; without, it must have succeeded.
## Returns true when the call succeeded.
static func _attempt(fails: Array, at: String, want, err: String) -> bool:
	if err != "":
		if want == null:
			fails.append("%s: unexpected error: %s" % [at, err])
		elif not err.contains(str(want)):
			fails.append('%s: error "%s" does not say "%s"' % [at, err, str(want)])
		return false
	if want != null:
		fails.append('%s: expected an error saying "%s", none was raised' % [at, str(want)])
	return true


## Value equality for the corpus (runner.ts same()): arrays element-wise IN ORDER (a
## saved flags list must come back as it went), Dictionaries by key set, numbers as one
## kind (JSON hands back floats, a bag may hold ints), and a boolean never a number.
static func same(a, b) -> bool:
	if a is Array or b is Array:
		if not (a is Array and b is Array) or a.size() != b.size():
			return false
		for i in a.size():
			if not same(a[i], b[i]):
				return false
		return true
	if a is Dictionary or b is Dictionary:
		if not (a is Dictionary and b is Dictionary) or a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not same(a[k], b[k]):
				return false
		return true
	var a_num := typeof(a) == TYPE_INT or typeof(a) == TYPE_FLOAT
	var b_num := typeof(b) == TYPE_INT or typeof(b) == TYPE_FLOAT
	if a_num or b_num:
		return a_num and b_num and float(a) == float(b)
	if typeof(a) != typeof(b):
		return false
	return a == b


## Declarations as the corpus carries them, copied so a case cannot edit its own data.
static func _decls(ds) -> Array:
	var out: Array = []
	for d in (ds if ds is Array else []):
		out.append((d as Dictionary).duplicate(true))
	return out


static func _show(v) -> String:
	return "<unset>" if v == null else JSON.stringify(v)
