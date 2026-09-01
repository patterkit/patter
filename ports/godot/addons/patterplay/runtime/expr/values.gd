# GENERATED - vendored from expr/ports/godot/values.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# Scalar value helpers, for Godot. THE SHARED SOURCE.
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# GDScript has no place for a value CLASS: a value is a plain Variant (bool /
# float / String / Array of String), so this is the helper module both families
# had, 59% alike, with a character-identical to_value.
#
# NO `class_name`: Godot registers those project-wide. Each addon wraps this in
# its own thin class_name shim.
# ---------------------------------------------------------------------------
extends RefCounted


## Normalise a host or JSON value into the four kinds the language has.
static func to_value(v) -> Variant:
	match typeof(v):
		TYPE_INT:
			return float(v)
		TYPE_FLOAT:
			return v
		TYPE_BOOL:
			return v
		TYPE_STRING, TYPE_STRING_NAME:
			return str(v)
		TYPE_ARRAY:
			var out: Array = []
			for x in v:
				out.append(str(x))
			return out
	return v


## `==` / `!=` semantics (the evaluator's valueEquals): primitives by value;
## flags as a SET, order irrelevant; mixed kinds unequal, and never an error.
## Booleans are never numbers (true != 1, matching JS ===); int and float are
## ONE numeric kind, because they are one type in the JS reference.
##
## Order was significant until 2026-09-01, and that was a bug: a flags value IS
## a set, and its stored order is an artefact of the order somebody happened to
## add things in. Compared as MULTISETS (sorted copies), so a duplicate still
## counts.
static func value_equals(a, b) -> bool:
	var ta := typeof(a)
	var tb := typeof(b)
	if ta == TYPE_ARRAY or tb == TYPE_ARRAY:
		if ta != TYPE_ARRAY or tb != TYPE_ARRAY:
			return false
		if a.size() != b.size():
			return false
		var x: Array = a.duplicate()
		var y: Array = b.duplicate()
		x.sort()
		y.sort()
		for i in x.size():
			if x[i] != y[i]:
				return false
		return true
	var a_num := ta == TYPE_INT or ta == TYPE_FLOAT
	var b_num := tb == TYPE_INT or tb == TYPE_FLOAT
	if a_num and b_num:
		return float(a) == float(b)
	if ta != tb:
		return false
	return a == b


## True when the value is numeric (int or float).
static func is_number(v) -> bool:
	var t := typeof(v)
	return t == TYPE_FLOAT or t == TYPE_INT


## The evaluator's error-message type names (mirrors JS typeof for the four
## value kinds; flags arrays read as "flags" rather than JS's "object").
static func type_name(v) -> String:
	match typeof(v):
		TYPE_BOOL:
			return "boolean"
		TYPE_FLOAT, TYPE_INT:
			return "number"
		TYPE_STRING, TYPE_STRING_NAME:
			return "string"
		TYPE_ARRAY:
			return "flags"
	return "unknown"


## Truthiness for a bare condition: booleans and numbers as you would expect, a
## string when non-empty, a flag list when non-empty. The two families
## disagreed about this until 2026-09-01, which mattered because they share a
## property registry: the same value read from the same registry answered a
## condition differently depending on which engine asked.
static func truthy(v) -> bool:
	match typeof(v):
		TYPE_BOOL:
			return v
		TYPE_FLOAT:
			return v != 0.0
		TYPE_INT:
			return v != 0
		TYPE_STRING, TYPE_STRING_NAME:
			return v != ""
		TYPE_ARRAY:
			return v.size() > 0
	return false


## Format a float the way JavaScript's String(n) does.
##
## This is the cross-runtime number-rendering contract, and it did NOT hold:
## both GDScript ports used a 1e15 integral cutoff, `str(int(n))` (which
## overflows int64 above ~9.2e18), and String.num's 14-decimal default with its
## trailing ".0". So 0.1+0.2 printed as "0.3", 1e16 as "10000000000000000.0",
## and 1/3 lost two digits. Patterplay's also had no NaN guard, printing "nan".
##
## Integral values below 1e21 print with no decimal point and no exponent.
## Everything else takes the SHORTEST representation that round-trips, which is
## what JS picks.
static func js_number(n: float) -> String:
	if is_nan(n):
		return "NaN"
	if is_inf(n):
		return "Infinity" if n > 0.0 else "-Infinity"
	if n == floor(n) and absf(n) < 1e21:
		return "%.0f" % n   # not int(): 1e20 is past int64
	for precision in range(1, 18):
		var s := String.num(n, precision)
		if s.to_float() == n:
			return s
	return String.num(n, 17)


## A compact JSON-ish rendering, for diagnostics and failure reports (the shape
## JSON.stringify gives the JS runner). Quotes strings; see render_slot for the
## display form.
static func show(v) -> String:
	match typeof(v):
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_FLOAT:
			return js_number(v)
		TYPE_INT:
			return js_number(float(v))
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(v))
		TYPE_ARRAY:
			var parts: Array = []
			for x in v:
				parts.append(show(x))
			return "[" + ",".join(parts) + "]"
	return str(v)


## A resolved slot value as display text: a bare string, a flag list joined with
## ", " (which is what the JS reference's renderSlotValue does).
static func render_slot(v) -> String:
	match typeof(v):
		TYPE_ARRAY:
			var parts := PackedStringArray()
			for x in v:
				parts.append(str(x))
			return ", ".join(parts)
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_FLOAT:
			return js_number(v)
		TYPE_INT:
			return js_number(float(v))
		TYPE_STRING, TYPE_STRING_NAME:
			return str(v)
	return str(v)
