# The expression evaluator + the Patter dialect - a port of @wildwinter/expr's evaluate.ts and
# @patterkit/dialect. Walks a compiled AST (the corpus's tagged-tuple Array form) against a context
# (scope resolvers + host hooks). Same operator typing, short-circuiting, value-equality, and built-ins.
#
# ctx = {
#   "scopes": { token: Callable(name) -> value-or-null },
#   "next_random": Callable() -> float (or null),
#   "visits": Callable(id) -> int (or null),
#   "patter_visits": Callable(id) -> int (or null),
# }
class_name PatterExpr


static func evaluate(node: Array, ctx: Dictionary):
	var tag = node[0]
	match tag:
		"b":
			return node[1]
		"n":
			return PatterValues.to_value(node[1])
		"s":
			return node[1]
		"sv":
			var scope = node[1]
			var name = node[2]
			var scopes: Dictionary = ctx["scopes"]
			if not scopes.has(scope):
				return false
			var v = scopes[scope].call(name)
			return v if v != null else false
		"call":
			return _eval_call(node, ctx)
		"fd":
			push_error("flagdelta node is only valid as an argument to a flag-delta function")
			return false
		"u":
			if node[1] == "not":
				var v = evaluate(node[2], ctx)
				return not v if typeof(v) == TYPE_BOOL else false
			var n = evaluate(node[2], ctx)
			return -n if typeof(n) == TYPE_FLOAT else 0.0
		"bin":
			return _eval_binary(node, ctx)
	push_error("unknown ast node")
	return false


static func _eval_binary(node: Array, ctx: Dictionary):
	var op = node[1]
	if op == "and":
		var l = evaluate(node[2], ctx)
		if typeof(l) != TYPE_BOOL or not l:
			return false
		var r = evaluate(node[3], ctx)
		return r if typeof(r) == TYPE_BOOL else false
	if op == "or":
		var l = evaluate(node[2], ctx)
		if typeof(l) == TYPE_BOOL and l:
			return true
		var r = evaluate(node[3], ctx)
		return r if typeof(r) == TYPE_BOOL else false

	var left = evaluate(node[2], ctx)
	var right = evaluate(node[3], ctx)
	match op:
		"==":
			return PatterValues.value_equals(left, right)
		"!=":
			return not PatterValues.value_equals(left, right)
		">":
			return _num(left) > _num(right)
		">=":
			return _num(left) >= _num(right)
		"<":
			return _num(left) < _num(right)
		"<=":
			return _num(left) <= _num(right)
		"+":
			if typeof(left) == TYPE_FLOAT and typeof(right) == TYPE_FLOAT:
				return left + right
			if typeof(left) == TYPE_STRING and typeof(right) == TYPE_STRING:
				return left + right
			push_error("'+' requires two numbers or two strings")
			return 0.0
		"-":
			return _num(left) - _num(right)
		"*":
			return _num(left) * _num(right)
		"/":
			var d = _num(right)
			if d == 0.0:
				push_error("division by zero")
				return 0.0
			return _num(left) / d
	push_error("unknown operator")
	return false


static func _num(v) -> float:
	return v if typeof(v) == TYPE_FLOAT else 0.0


static func _eval_call(node: Array, ctx: Dictionary):
	var fn = node[1]
	var args: Array = node.slice(2)
	match fn:
		"random":
			if args.size() != 2 or ctx.get("next_random") == null:
				push_error("random(a, b) requires 2 args and a PRNG")
				return 0.0
			var a = evaluate(args[0], ctx)
			var b = evaluate(args[1], ctx)
			var lo = min(a, b)
			var hi = max(a, b)
			return floor(ctx["next_random"].call() * (hi - lo + 1.0)) + lo
		"check_flags":
			var flags := _read_flags(args[0] if args.size() > 0 else null, ctx)
			for i in range(1, args.size()):
				var arg = args[i]
				var has_flag := flags.has(arg[2])
				if (arg[1] == "+") != has_flag:
					return false
			return true
		"set_flags":
			var result := _read_flags(args[0] if args.size() > 0 else null, ctx).duplicate()
			for i in range(1, args.size()):
				var arg = args[i]
				if arg[1] == "+":
					if not result.has(arg[2]):
						result.append(arg[2])
				else:
					result.erase(arg[2])
			return result
		"visits":
			return float(_host_int(ctx, "visits", _node_id(args, ctx)))
		"seen":
			return _host_int(ctx, "visits", _node_id(args, ctx)) > 0
		"patter_visits":
			return float(_host_int(ctx, "patter_visits", _node_id(args, ctx)))
		"patter_seen":
			return _host_int(ctx, "patter_visits", _node_id(args, ctx)) > 0
	push_error("unknown function '%s'" % fn)
	return false


static func _host_int(ctx: Dictionary, key: String, id: String) -> int:
	var cb = ctx.get(key)
	return int(cb.call(id)) if cb != null else 0


static func _node_id(args: Array, ctx: Dictionary) -> String:
	if args.is_empty():
		return ""
	var v = evaluate(args[0], ctx)
	return v if typeof(v) == TYPE_STRING else ""


static func _read_flags(arg, ctx: Dictionary) -> Array:
	if arg == null:
		return []
	var v = evaluate(arg, ctx)
	if typeof(v) == TYPE_ARRAY:
		return v
	if typeof(v) == TYPE_BOOL and not v:
		return []
	return []
