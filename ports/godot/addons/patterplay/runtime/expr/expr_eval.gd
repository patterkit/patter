# GENERATED - vendored from expr/ports/godot/expr_eval.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# @wildwinter/expr - the evaluator, for Godot. THE SHARED SOURCE.
#
# Authored here and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy: CI regenerates
# this file into both addons and fails on `git diff --exit-code`, so a hand
# edit downstream is caught rather than silently becoming a seventh dialect of
# the same 200 lines.
#
# Port of evaluate.ts. Walks a compiled AST (the tagged-tuple Array form a
# bundle and the conformance corpus both carry, so there is no deserialisation
# pass and no node cache) against a context, parameterised by a dialect.
#
# NO `class_name`. Godot registers class_name in a PROJECT-WIDE namespace, so a
# shared file that claimed one would collide the moment a game installed two
# addons that both vendor it. Each family wraps this in its own thin
# `class_name` shim instead; identity belongs to the installing plugin, never
# to the shared source. See expr/docs/port-sharing.md.
#
# GDScript has no exceptions, so an eval error is a returned EvalError object
# (unambiguous: scalar values are only bool / float / String / Array). Callers
# test with is_error(). The semantics are identical to the TS throw paths: a
# condition that errors is a fail-plus-diagnostic, never a silent pass.
#
# Context shape:
#   {"scopes": {token: Dictionary bag | Callable get(name)}, ...host keys}
# A scope absent from the map resolves to false (graceful). A property missing
# from a PRESENT scope follows the dialect's per-scope missing policy
# ("false" | "throw").
#
# Dialect shape:
#   {"scopes": [{"token", "missing"?}], "default_scope",
#    "functions": {name: Callable(args: Array, helpers: Dictionary)}}
# `helpers` is {"evaluate": Callable(node) -> value, "ctx": Dictionary}. A
# dialect function reads whatever host hooks it wants off `ctx`, which is why
# the two families can keep different context conventions (Storylets nests them
# under "host", Patter keeps them at the top level) and still share this file.
#
# TRUTHINESS IS NOT HERE, on purpose. Turning a value into a condition's
# yes/no is host policy: Storylets admits only booleans and numbers, Patter
# also admits a non-empty string or flag list. expr-specificity's `EvalTruthy`
# records that as a host-bound decision, and it stays in each family's values
# module.
# ---------------------------------------------------------------------------


class EvalError:
	extends RefCounted
	var message: String

	func _init(msg: String) -> void:
		message = msg


static func error(message: String) -> EvalError:
	return EvalError.new(message)


static func is_error(v) -> bool:
	return v is EvalError


## Equality, type names and numeric predicates come from the values module
## beside this, not a second copy here. This file carried its own until
## 2026-09-01, which is precisely the duplication the whole exercise is about:
## the two value_equals could then disagree, and when flags equality changed
## from ordered to set semantics, exactly one of them would have been updated.
const Values := preload("values.gd")


static func is_number(v) -> bool:
	return Values.is_number(v)


static func type_name(v) -> String:
	return Values.type_name(v)


static func value_equals(a, b) -> bool:
	return Values.value_equals(a, b)


## Evaluate `node` in `ctx` under `dialect`; a scalar value or an EvalError.
static func evaluate(node: Array, ctx: Dictionary, dialect: Dictionary) -> Variant:
	# Per-scope missing-property policy, precomputed once per top-level evaluate.
	var policy := {}
	for sc in dialect.get("scopes", []):
		policy[sc["token"]] = sc.get("missing", "false")
	return _rec(node, ctx, dialect, policy)


static func _rec(node: Array, ctx: Dictionary, dialect: Dictionary, policy: Dictionary) -> Variant:
	var tag = node[0]
	match tag:
		"b":
			return node[1]
		"n":
			# JSON hands integers back as ints; the language has one number type.
			return float(node[1])
		"s":
			return node[1]
		"sv":
			var scope = node[1]
			var name = node[2]
			var scopes: Dictionary = ctx.get("scopes", {})
			if not scopes.has(scope):
				# Scope context absent -> graceful false.
				return false
			var bag = scopes[scope]
			var v = null
			if bag is Callable:
				# A host resolver (foreign scope): Callable(name) -> value | null.
				v = bag.call(name)
			elif bag is Dictionary:
				v = bag.get(name)
			if v == null:
				# Property not declared on the PRESENT scope. Policy decides.
				if policy.get(scope) == "throw":
					return error("@%s.%s is not declared on the current %s." % [scope, name, scope])
				return false
			return v
		"call":
			return _eval_call(node, ctx, dialect, policy)
		"fd":
			return error("flagdelta node is only valid as an argument to a flag-delta function")
		"u":
			var v = _rec(node[2], ctx, dialect, policy)
			if is_error(v):
				return v
			if node[1] == "not":
				if typeof(v) != TYPE_BOOL:
					return error("'not' requires a boolean operand, got %s" % type_name(v))
				return not v
			# neg
			if not is_number(v):
				return error("unary '-' requires a numeric operand, got %s" % type_name(v))
			return -float(v)
		"bin":
			return _eval_binary(node, ctx, dialect, policy)
	return error("unknown ast node '%s'" % str(tag))


static func _eval_binary(node: Array, ctx: Dictionary, dialect: Dictionary, policy: Dictionary) -> Variant:
	var op = node[1]

	# Short-circuit operators first.
	if op == "and" or op == "or":
		var l = _rec(node[2], ctx, dialect, policy)
		if is_error(l):
			return l
		if typeof(l) != TYPE_BOOL:
			return error("'%s' requires boolean operands, left is %s" % [op, type_name(l)])
		if op == "and" and not l:
			return false
		if op == "or" and l:
			return true
		var r = _rec(node[3], ctx, dialect, policy)
		if is_error(r):
			return r
		if typeof(r) != TYPE_BOOL:
			return error("'%s' requires boolean operands, right is %s" % [op, type_name(r)])
		return r

	var left = _rec(node[2], ctx, dialect, policy)
	if is_error(left):
		return left
	var right = _rec(node[3], ctx, dialect, policy)
	if is_error(right):
		return right

	# Quality: when either operand REFERENCES a quality (the node carries the
	# scope+name the channel resolves), ordering compares by ladder POSITION and
	# arithmetic is refused. == / != fall through to plain value equality.
	var l_ladder = _ladder_of(node[2], ctx)
	var r_ladder = _ladder_of(node[3], ctx)
	var ladder = l_ladder if l_ladder != null else r_ladder
	if ladder != null:
		var ordering: bool = op == ">" or op == ">=" or op == "<" or op == "<="
		if ordering and l_ladder != null and r_ladder != null and l_ladder != r_ladder:
			return error("'%s' compares two different qualities, whose stage orders are unrelated" % op)
		if ordering:
			var li = _stage_index(left, ladder, op)
			if is_error(li):
				return li
			var ri = _stage_index(right, ladder, op)
			if is_error(ri):
				return ri
			match op:
				">":
					return int(li) > int(ri)
				">=":
					return int(li) >= int(ri)
				"<":
					return int(li) < int(ri)
				_:
					return int(li) <= int(ri)
		if op == "+" or op == "-" or op == "*" or op == "/":
			return error("'%s' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it" % op)

	match op:
		"==":
			return value_equals(left, right)
		"!=":
			return not value_equals(left, right)
		">", ">=", "<", "<=":
			if not is_number(left) or not is_number(right):
				return error("'%s' requires numeric operands, got %s and %s" % [op, type_name(left), type_name(right)])
			var lf := float(left)
			var rf := float(right)
			match op:
				">":
					return lf > rf
				">=":
					return lf >= rf
				"<":
					return lf < rf
				_:
					return lf <= rf
		"+":
			if is_number(left) and is_number(right):
				return float(left) + float(right)
			if left is String and right is String:
				return left + right
			return error("'+' requires two numbers or two strings, got %s and %s" % [type_name(left), type_name(right)])
		"-", "*", "/":
			if not is_number(left) or not is_number(right):
				return error("'%s' requires numeric operands, got %s and %s" % [op, type_name(left), type_name(right)])
			var a := float(left)
			var b := float(right)
			match op:
				"-":
					return a - b
				"*":
					return a * b
				_:
					if b == 0.0:
						return error("division by zero")
					return a / b

	return error("unknown operator '%s'" % str(op))


# The ladder behind an operand NODE, when the context's quality channel says it
# references one (null otherwise). Values are plain strings; the node is what
# carries the (scope, name) the channel needs.
static func _ladder_of(node, ctx: Dictionary) -> Variant:
	if not ctx.has("qualities") or typeof(node) != TYPE_ARRAY or node.size() < 3 or node[0] != "sv":
		return null
	return (ctx["qualities"] as Callable).call(node[1], node[2])


# Index of a stage in a ladder; an unknown stage is an error naming the value
# (a drifted save is exactly what lands here), never a silent never-match.
static func _stage_index(value, ladder: Variant, op: String) -> Variant:
	if typeof(value) != TYPE_STRING:
		return error("'%s' on a quality compares stages, got %s" % [op, type_name(value)])
	var i: int = (ladder as Array).find(value)
	if i < 0:
		return error('"%s" is not a stage of this quality (stages: %s)' % [value, ", ".join(ladder as Array)])
	return i


static func _eval_call(node: Array, ctx: Dictionary, dialect: Dictionary, policy: Dictionary) -> Variant:
	var fn = node[1]
	var args: Array = node.slice(2)
	var functions: Dictionary = dialect.get("functions", {})
	# advance() is the language's own: the NEXT stage in the argument's ladder,
	# saturating at the last. Core rather than dialect, because it IS the quality
	# design's insertion mechanism and every dialect should say it the same way.
	# A dialect defining its own advance still wins.
	if fn == "advance" and not functions.has("advance"):
		if args.size() != 1:
			return error("advance() takes exactly 1 argument, got %d" % args.size())
		var ladder = _ladder_of(args[0], ctx)
		if ladder == null:
			return error("advance() needs a quality reference (@scope.name of a quality property)")
		var current = _rec(args[0], ctx, dialect, policy)
		if is_error(current):
			return current
		var idx = _stage_index(current, ladder, "advance")
		if is_error(idx):
			return idx
		return str((ladder as Array)[mini(int(idx) + 1, (ladder as Array).size() - 1)])
	if not functions.has(fn):
		return error("unknown function '%s'" % str(fn))
	var helpers := {
		"evaluate": func(child: Array): return _rec(child, ctx, dialect, policy),
		"ctx": ctx,
	}
	return (functions[fn] as Callable).call(args, helpers)
