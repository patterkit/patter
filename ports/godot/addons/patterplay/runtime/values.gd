# Patter scalar-value helpers. Values are native GDScript Variants: bool / float / String /
# Array[String] (flags). All numbers are normalised to float so value-equality matches the JS
# runtime (true === 1 is false; 8 === 8.0 is true). Mirrors PatterValue in the C#/C++ ports.
class_name PatterValues


# Normalise a JSON-parsed value: ints -> float, string arrays kept, others as-is.
static func to_value(v):
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


# `==` / `!=` semantics: primitives by value; flags element-wise; mixed kinds unequal.
static func value_equals(a, b) -> bool:
	var ta := typeof(a)
	var tb := typeof(b)
	if ta == TYPE_ARRAY or tb == TYPE_ARRAY:
		if ta != TYPE_ARRAY or tb != TYPE_ARRAY:
			return false
		if a.size() != b.size():
			return false
		for i in a.size():
			if a[i] != b[i]:
				return false
		return true
	if ta != tb:
		return false
	return a == b


static func truthy(v) -> bool:
	match typeof(v):
		TYPE_BOOL:
			return v
		TYPE_FLOAT:
			return v != 0.0
		TYPE_INT:
			return v != 0
		TYPE_STRING:
			return v != ""
		TYPE_ARRAY:
			return v.size() > 0
	return false


# Format a number the way JavaScript's String(n) does (the interpolation contract): integral
# values print with no decimal point.
static func js_number(n: float) -> String:
	if n == floor(n) and abs(n) < 1e15:
		return str(int(n))
	return String.num(n)


# A resolved slot value as display text (flags joined with ", ").
static func render_slot(v) -> String:
	match typeof(v):
		TYPE_ARRAY:
			return ", ".join(_as_strings(v))
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_FLOAT:
			return js_number(v)
		TYPE_INT:
			return js_number(float(v))
		TYPE_STRING:
			return v
	return str(v)


static func _as_strings(arr: Array) -> PackedStringArray:
	var out := PackedStringArray()
	for x in arr:
		out.append(str(x))
	return out
