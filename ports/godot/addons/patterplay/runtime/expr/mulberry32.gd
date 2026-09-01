# GENERATED - vendored from expr/ports/godot/mulberry32.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# mulberry32 - the contractual PRNG, for Godot. THE SHARED SOURCE.
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# NO `class_name`: Godot registers those project-wide. Each family wraps this in
# its own thin class_name shim.
#
# A fixed, published algorithm that both product families need and neither owns.
# Port of @wildwinter/expr's prng.ts. Worked in unsigned 32-bit by masking with
# & 0xffffffff at every step, matching JavaScript's `>>> 0` and Math.imul;
# GDScript ints are 64-bit, so the masks keep us in range.
# ---------------------------------------------------------------------------
extends RefCounted

## The persisted state (a uint32). Public because a save reads it directly.
var a: int


func _init(seed_value: float = 0.0) -> void:
	a = to_uint32(seed_value)


## JS ToUint32, for a numeric seed or a persisted state read back as a float.
## Non-finite goes to +0, never to uint32 max; a negative wraps modulo 2^32,
## never clamps. Taking a float rather than an int is the point: the JS API's
## seed is a `number`, and an int parameter silently loses every seed outside
## int64, which is how 1e19 and Infinity both answered 4294967295 here.
static func to_uint32(seed_value: float) -> int:
	if is_nan(seed_value) or is_inf(seed_value):
		return 0
	# fmod first, then int(): fmod's result carries the dividend's sign and is
	# under 2^32 in magnitude, so int() truncates towards zero without any risk
	# of overflowing GDScript's 64-bit int on a seed like 1e19.
	var modded := fmod(seed_value, 4294967296.0)
	var whole := int(modded)
	if whole < 0:
		whole += 4294967296
	return whole & 0xffffffff


## One draw in [0, 1); advances the state.
func next() -> float:
	a = (a + 0x6d2b79f5) & 0xffffffff
	var t := _imul(a ^ (a >> 15), 1 | a)
	t = (((t + _imul(t ^ (t >> 7), 61 | t)) & 0xffffffff) ^ t) & 0xffffffff
	return float((t ^ (t >> 14)) & 0xffffffff) / 4294967296.0


## The persisted state, as the TS `state()` spells it.
func state() -> int:
	return a


## The contractual shuffle: Fisher-Yates, descending. Runs of one element
## consume no draws (the loop never executes for size < 2).
static func shuffle_in_place(arr: Array, prng) -> void:
	for i in range(arr.size() - 1, 0, -1):
		var j := int(floor(prng.next() * float(i + 1)))
		var tmp = arr[i]
		arr[i] = arr[j]
		arr[j] = tmp


# Math.imul: the low 32 bits of x*y. Computed via 16-bit halves so the
# intermediate product never overflows GDScript's signed 64-bit int (a full
# 32x32 multiply would reach ~2^64).
static func _imul(x: int, y: int) -> int:
	x = x & 0xffffffff
	y = y & 0xffffffff
	var xl := x & 0xffff
	var xh := (x >> 16) & 0xffff
	return (xl * y + (((xh * y) & 0xffff) << 16)) & 0xffffffff
