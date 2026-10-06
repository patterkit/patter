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
## The shortest digits that round-trip, laid out by ECMAScript's Number::toString
## rules: plain digits from 1e-7 up to (not including) 1e21; outside that, an
## exponent with a lower-case "e" and its sign ("1.5e-7", "1e+21"); -0 as "0".
## Until 2026-10 this port used String.num at growing precision, which printed
## 1.5e-7 as "0.00000015" and 1e21 as a long run of digits.
static func js_number(n: float) -> String:
	if is_nan(n):
		return "NaN"
	if is_inf(n):
		return "Infinity" if n > 0.0 else "-Infinity"
	if n == 0.0:
		return "0"   # -0 included
	if n == floor(n) and absf(n) < 9007199254740992.0:
		return "%.0f" % n   # a whole number below 2^53 prints exactly (not int(): stay in float)
	# The shortest digits that read back as this float: round the EXACT value to 1, 2, 3... significant
	# digits (ties to even, as JS does) and take the first that falls inside the float's rounding
	# interval, the midpoints to its neighbours. All in exact decimal arithmetic: Godot's own float
	# printing breaks ties the other way and prints 1e23 as 9.999999999999999e+22, and its parser is not
	# exact at extreme exponents, so neither can be the judge.
	var parts := _float_parts(absf(n))
	var m: int = parts[0]
	var e2: int = parts[1]
	var exact := _exact_decimal(m, e2)
	var high := _exact_decimal(2 * m + 1, e2 - 1)
	# Below a power of two the gap to the lower neighbour halves (unless that neighbour is subnormal).
	var low := _exact_decimal(4 * m - 1, e2 - 2) if m == (1 << 52) and e2 > -1074 else _exact_decimal(2 * m - 1, e2 - 1)
	var inclusive := m % 2 == 0   # a decimal exactly on a midpoint reads back as the even neighbour
	var best: Array = exact
	for p in range(1, 18):
		var r: Array = _round_significant(exact[0], exact[1], p)
		var above := _cmp_decimal(r, low)
		var below := _cmp_decimal(r, high)
		if (above > 0 or (inclusive and above == 0)) and (below < 0 or (inclusive and below == 0)):
			best = r
			break
	return ("-" if n < 0.0 else "") + _js_layout(best[0], best[1])


## A positive finite float as [m, e2] with the value m x 2^e2.
static func _float_parts(a: float) -> Array:
	var bytes := PackedByteArray()
	bytes.resize(8)
	bytes.encode_double(0, a)
	var bits := bytes.decode_s64(0)
	var exp_bits := (bits >> 52) & 0x7FF
	var mant := bits & 0xFFFFFFFFFFFFF
	if exp_bits == 0:
		return [mant, -1074]   # subnormal
	return [mant | (1 << 52), exp_bits - 1075]


## The exact decimal value of m x 2^e2 (m > 0), as [digits, point]: the value is
## 0.d1d2..dk x 10^point, with no leading or trailing zero digits. For e2 < 0 it
## is m x 5^-e2 / 10^-e2, so a little base-1e9 integer arithmetic gives every digit.
static func _exact_decimal(m: int, e2: int) -> Array:
	var limbs: Array[int] = [m % 1000000000, (m / 1000000000) % 1000000000, m / 1000000000000000000]
	var frac_digits := 0
	if e2 > 0:
		var left := e2
		while left > 0:
			var step := mini(left, 30)
			_limbs_mul(limbs, 1 << step)
			left -= step
	else:
		frac_digits = -e2
		var left := -e2
		while left > 0:
			var step := mini(left, 13)
			_limbs_mul(limbs, int(pow(5.0, step)))
			left -= step
	var text := ""
	for i in range(limbs.size() - 1, -1, -1):
		text += "%09d" % limbs[i]
	text = text.lstrip("0")
	var point := text.length() - frac_digits
	return [text.rstrip("0"), point]


static func _limbs_mul(limbs: Array[int], by: int) -> void:
	var carry := 0
	for i in limbs.size():
		var v: int = limbs[i] * by + carry
		limbs[i] = v % 1000000000
		carry = v / 1000000000
	while carry > 0:
		limbs.append(carry % 1000000000)
		carry /= 1000000000


## Compare two positive decimals given as [digits, point]: -1, 0 or 1.
static func _cmp_decimal(a: Array, b: Array) -> int:
	if a[1] != b[1]:
		return -1 if a[1] < b[1] else 1
	var x: String = a[0]
	var y: String = b[0]
	var width := maxi(x.length(), y.length())
	x = x.rpad(width, "0")
	y = y.rpad(width, "0")
	if x == y:
		return 0
	return -1 if x < y else 1


## `digits` rounded to `p` significant digits, half to even, as [digits, point].
static func _round_significant(digits: String, point: int, p: int) -> Array:
	if digits.length() <= p:
		return [digits, point]
	var head := digits.substr(0, p)
	var next := digits.unicode_at(p) - 48
	var up := next > 5
	if next == 5:
		up = digits.substr(p + 1).rstrip("0") != "" or (head.unicode_at(p - 1) - 48) % 2 == 1
	if up:
		var chars := head.to_ascii_buffer()
		var i := p - 1
		while i >= 0 and chars[i] == 57:   # '9'
			chars[i] = 48
			i -= 1
		if i < 0:
			return ["1", point + 1]
		chars[i] += 1
		head = chars.get_string_from_ascii()
	head = head.rstrip("0")
	return [head if head != "" else "0", point]


## ECMAScript's layout for digits d1..dk with the decimal point `point` places
## from the left (the value is 0.d1..dk x 10^point).
static func _js_layout(d: String, point: int) -> String:
	var k := d.length()
	if k <= point and point <= 21:
		return d + "0".repeat(point - k)
	if 0 < point and point <= 21:
		return d.substr(0, point) + "." + d.substr(point)
	if -6 < point and point <= 0:
		return "0." + "0".repeat(-point) + d
	var e := point - 1
	var exp := ("-" if e < 0 else "+") + str(absi(e))
	return (d if k == 1 else d.substr(0, 1) + "." + d.substr(1)) + "e" + exp


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
