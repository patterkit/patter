# The Patter expression dialect - port of @patterkit/dialect. Split out of
# expression.gd on 2026-09-01: until then Patterplay fused its dialect into its
# evaluator in all three ports, and had no Dialect.* file anywhere, which is the
# one thing that stopped the evaluator ever being shared with the Storylet
# Engine. The seam exists on their side (Dialect.h / Dialect.cs / dialect.gd) and
# now on ours, in the same shape.
#
# Scopes are declared EMPTY on purpose. Patter has no missing-property policy: a
# property absent from a present scope reads as a graceful false, which is the
# core's default when a scope carries no policy. Storylets declares its five
# scopes "throw" because every property there has a declared default, so absence
# means a publish bug. Same evaluator, two configurations, which is the point.
#
# Host callbacks are read from the context directly (this port keeps them at the
# top level of ctx rather than under a "host" key):
#   next_random() -> float          one PRNG draw in [0, 1)
#   visits(id) -> int               visits to a node, this flow
#   patter_visits(id) -> int        visits to a node, shared across flows
class_name PatterDialect


## Build the dialect descriptor PatterExpr.evaluate consumes. Callers should
## hold one instance (the flow builds it once).
static func dialect() -> Dictionary:
	return {
		"scopes": [],
		"default_scope": "patter",
		"functions": {
			"random": Callable(PatterDialect, "_fn_random"),
			"check_flags": Callable(PatterDialect, "_fn_check_flags"),
			"set_flags": Callable(PatterDialect, "_fn_set_flags"),
			"visits": Callable(PatterDialect, "_fn_visits"),
			"seen": Callable(PatterDialect, "_fn_seen"),
			"patter_visits": Callable(PatterDialect, "_fn_patter_visits"),
			"patter_seen": Callable(PatterDialect, "_fn_patter_seen"),
		},
	}


static func _fn_random(args: Array, h: Dictionary) -> Variant:
	var ctx: Dictionary = h["ctx"]
	if args.size() != 2 or ctx.get("next_random") == null:
		return PatterExpr.error("random(a, b) requires 2 args and a PRNG")
	var a = (h["evaluate"] as Callable).call(args[0])
	if PatterExpr.is_error(a):
		return a
	var b = (h["evaluate"] as Callable).call(args[1])
	if PatterExpr.is_error(b):
		return b
	if not PatterValues.is_number(a) or not PatterValues.is_number(b):
		return PatterExpr.error("random(a, b) arguments must be numbers")
	var lo = min(a, b)
	var hi = max(a, b)
	return floor(ctx["next_random"].call() * (hi - lo + 1.0)) + lo


static func _fn_check_flags(args: Array, h: Dictionary) -> Variant:
	var flags = _read_flags(args[0] if args.size() > 0 else null, h)
	if PatterExpr.is_error(flags):
		return flags
	for i in range(1, args.size()):
		var arg = args[i]
		var has_flag: bool = (flags as Array).has(arg[2])
		if (arg[1] == "+") != has_flag:
			return false
	return true


static func _fn_set_flags(args: Array, h: Dictionary) -> Variant:
	var base = _read_flags(args[0] if args.size() > 0 else null, h)
	if PatterExpr.is_error(base):
		return base
	var result: Array = (base as Array).duplicate()
	for i in range(1, args.size()):
		var arg = args[i]
		if arg[1] == "+":
			if not result.has(arg[2]):
				result.append(arg[2])
		else:
			result.erase(arg[2])
	return result


static func _fn_visits(args: Array, h: Dictionary) -> Variant:
	return _count(args, h, "visits", false)


static func _fn_seen(args: Array, h: Dictionary) -> Variant:
	return _count(args, h, "visits", true)


static func _fn_patter_visits(args: Array, h: Dictionary) -> Variant:
	return _count(args, h, "patter_visits", false)


static func _fn_patter_seen(args: Array, h: Dictionary) -> Variant:
	return _count(args, h, "patter_visits", true)


static func _count(args: Array, h: Dictionary, key: String, as_bool: bool) -> Variant:
	var id = _node_id(args, h)
	if PatterExpr.is_error(id):
		return id
	var cb = (h["ctx"] as Dictionary).get(key)
	var n: int = int(cb.call(id)) if cb != null else 0
	return (n > 0) if as_bool else float(n)


static func _node_id(args: Array, h: Dictionary) -> Variant:
	if args.is_empty():
		return ""
	var v = (h["evaluate"] as Callable).call(args[0])
	if PatterExpr.is_error(v):
		return v
	return v if typeof(v) == TYPE_STRING else ""


static func _read_flags(arg, h: Dictionary) -> Variant:
	if arg == null:
		return []
	var v = (h["evaluate"] as Callable).call(arg)
	if PatterExpr.is_error(v):
		return v
	if typeof(v) == TYPE_ARRAY:
		return v
	# A flags property that has never been set reads as a graceful false; an
	# empty flag list is the right reading of that, not an error.
	if typeof(v) == TYPE_BOOL and not v:
		return []
	return PatterExpr.error("check_flags()/set_flags() first argument must be a flags property, got %s" % PatterValues.type_name(v))
