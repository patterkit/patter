# The Patterplay version, and the one check against it, rule for rule the JS reference's version.ts.
#
# An extension (Patterstage, Pattershot) ships apart from Patterplay and never bundles it, so it checks at start-up
# that the Patterplay it finds is one it was built for. Godot's plugin.cfg can't declare a version range, so the
# check runs in code: CURRENT says what this runtime is, and in_range tests it.
class_name PatterplayVersion


## This runtime's version, as in its plugin.cfg. Written by `npm run bump:play`; never edit it by hand.
const CURRENT := "0.42.0"

# The JS reference's pattern, with \z for its $ (PCRE's $ would also match before a final newline).
const _SEMVER := "^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?\\z"

static var _regex: RegEx = null


## Whether `version` is at least `min` and below `max_exclusive`, by semantic-version precedence (build metadata
## after `+` is ignored, and a prerelease comes before its release). False when any of the three isn't a version.
## An extension built for Patterplay 0.41 checks `PatterplayVersion.in_range(PatterplayVersion.CURRENT, "0.41.0", "0.42.0")`.
static func in_range(version: String, min: String, max_exclusive: String) -> bool:
	var v := _parse(version)
	var lo := _parse(min)
	var hi := _parse(max_exclusive)
	if v.is_empty() or lo.is_empty() or hi.is_empty():
		return false
	return _compare(v, lo) >= 0 and _compare(v, hi) < 0


# {"core": [major, minor, patch] as digit strings, "pre": prerelease identifiers}, or empty when it isn't a version.
static func _parse(v: String) -> Dictionary:
	if _regex == null:
		_regex = RegEx.create_from_string(_SEMVER)
	var m := _regex.search(v)
	if m == null:
		return {}
	var pre: String = m.get_string(4)
	return {
		"core": [m.get_string(1), m.get_string(2), m.get_string(3)],
		"pre": pre.split(".") if pre != "" else PackedStringArray(),
	}


# Two runs of digits compared as numbers, however long: by length once leading zeros are gone, then digit by digit.
static func _compare_digits(a: String, b: String) -> int:
	var x := a.lstrip("0")
	var y := b.lstrip("0")
	if x.length() != y.length():
		return -1 if x.length() < y.length() else 1
	if x == y:
		return 0
	return -1 if x < y else 1


static func _is_digits(s: String) -> bool:
	for i in s.length():
		var c := s.unicode_at(i)
		if c < 48 or c > 57:
			return false
	return s.length() > 0


# Semantic-version precedence: negative when a comes first, positive when b does, 0 when they're equal.
static func _compare(a: Dictionary, b: Dictionary) -> int:
	for i in 3:
		var c := _compare_digits(a["core"][i], b["core"][i])
		if c != 0:
			return c
	var ap: PackedStringArray = a["pre"]
	var bp: PackedStringArray = b["pre"]
	# A prerelease comes before its release.
	if ap.is_empty() or bp.is_empty():
		return bp.size() - ap.size()
	for i in mini(ap.size(), bp.size()):
		var x := ap[i]
		var y := bp[i]
		if x == y:
			continue
		var xn := _is_digits(x)
		var yn := _is_digits(y)
		if xn and yn:
			var c := _compare_digits(x, y)
			if c != 0:
				return c
			continue  # 07 and 7 are the same number
		if xn != yn:
			return -1 if xn else 1  # a numeric identifier comes before a word
		return -1 if x < y else 1  # by code point, which for these characters is ASCII
	return ap.size() - bp.size()
