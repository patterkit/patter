# mulberry32 - the seeded PRNG behind random() / shuffle. Byte-identical to the JS runtime's,
# part of the parity contract. Worked in unsigned 32-bit (masking with & 0xffffffff), matching
# JavaScript's `| 0` / `>>> 0` / Math.imul. GDScript ints are 64-bit, so the masks keep us in range.
class_name Mulberry32
extends RefCounted

var a: int


func _init(seed_value: int) -> void:
	a = seed_value & 0xffffffff


func next() -> float:
	a = (a + 0x6d2b79f5) & 0xffffffff
	var t := _imul(a ^ (a >> 15), 1 | a)
	t = ((t + _imul(t ^ (t >> 7), 61 | t)) & 0xffffffff) ^ t
	t = t & 0xffffffff
	return float((t ^ (t >> 14)) & 0xffffffff) / 4294967296.0


# Math.imul: the low 32 bits of x*y. Computed via 16-bit halves so the intermediate product never
# overflows GDScript's signed 64-bit int (a full 32x32 multiply would reach ~2^64).
static func _imul(x: int, y: int) -> int:
	x = x & 0xffffffff
	y = y & 0xffffffff
	var xl := x & 0xffff
	var xh := (x >> 16) & 0xffff
	return (xl * y + (((xh * y) & 0xffff) << 16)) & 0xffffffff
