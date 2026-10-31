# Speech units (design/proposals/syllable-counter.md): a line broken into the syllables it would be spoken in, the
# beats with the mouth shut, and the pauses at its punctuation, each with a weight. PatterBundle.estimate_line_duration
# times a line with no recording by their total weight; a game lays the same units over a line's real or estimated
# length to move a mouth, so the timing and the mouth can't disagree. The public surface is
# PatterBundle.speech_units and PatterBundle.count_syllables; this is the counter behind them, rule for rule the JS
# reference's speech.ts.
#
# Counted from text alone, per script, by one generated table (speech_table.gd) that every runtime carries:
# - Latin: groups of vowels per word, at least one; in English and French a lone final e is silent ("lamps are lit",
#   "une lampe"), except English's consonant + le ("table").
# - Cyrillic: one per vowel letter, at least one a word.
# - Han: one per character, two in Japanese text (a kanji's reading can't be known without a dictionary).
# - Kana: one per mora. A small kana merges with the one before, っ is a beat with the mouth shut, ー holds the one
#   before for another beat.
# - Hangul: one per syllable block.
# - Arabic: one per written short vowel, or with none written, one per two letters, at least one a word.
# - Thai: one per vowel (a vowel written before its consonant takes the vowel signs that follow within two
#   consonants), plus one per two consonants with no vowel between them; a space between Thai words is a short pause.
# - Any other script: one per three letters a word, at least one.
# - A digit weighs 1.5. Emoji, symbols, markup (`<b>`, `&amp;`), and white space weigh nothing.
# - Pauses: short (`,` `;` `:` `、` `،` a dash) weigh 1, long (`.` `!` `?` `。` `؟` `…` `।`) 2. Punctuation in a row is
#   one pause, the stronger; a pause before the first syllable or after the last is dropped (the line's padAfter
#   is the pause after it), as is a `.` or `,` between digits (3.5, 1,000).
#
# Offsets are code points (a Godot String holds one per character), so every runtime agrees whatever its encoding.
class_name PatterSpeech

const K := preload("speech_table.gd")  # PatterSpeechTable

## The classes each kind of word is made of (a mark or a joining apostrophe continues any of them).
const LATIN := [K.LATIN_VOWEL, K.LATIN_LETTER]
const CYRILLIC := [K.CYRILLIC_VOWEL, K.CYRILLIC_LETTER]
const ARABIC := [K.ARABIC_LETTER, K.ARABIC_VOWEL]
const THAI := [K.THAI_CONSONANT, K.THAI_LEAD, K.THAI_VOWEL]
const OTHER := [K.OTHER_LETTER]
const KANA_CLASSES := [K.KANA, K.KANA_SMALL, K.KANA_SOKUON, K.KANA_LONG]


## A code point's class, by binary search of the table.
static func class_of(cp: int) -> int:
	var ranges := K.RANGES
	var lo := 0
	var hi := ranges.size() / 3 - 1
	while lo <= hi:
		var mid := (lo + hi) >> 1
		if cp < ranges[mid * 3]:
			hi = mid - 1
		elif cp > ranges[mid * 3 + 1]:
			lo = mid + 1
		else:
			return ranges[mid * 3 + 2]
	return K.NONE


## A locale's language, lower case: `en-GB`, `en_gb`, and `EN` are all `en`.
static func _language_of(locale: String) -> String:
	return locale.split("-")[0].split("_")[0].to_lower()


## An array's entry, or -1 past either end (every array here holds numbers that are never negative).
static func _at(a, j: int) -> int:
	return a[j] if j >= 0 and j < a.size() else -1


static func _is_ascii_letter(cp: int) -> bool:
	return (cp >= 0x41 and cp <= 0x5A) or (cp >= 0x61 and cp <= 0x7A)


static func _is_ascii_digit(cp: int) -> bool:
	return cp >= 0x30 and cp <= 0x39


## Where markup starting at `i` ends (exclusive): a formatting tag (`<b>`, `</bi>`) or an entity (`&amp;`,
## `&#38;`). `i` itself when there's none.
static func _markup_end(cps: PackedInt32Array, i: int) -> int:
	if _at(cps, i) == 0x3C:  # <
		var j := i + 1
		if _at(cps, j) == 0x2F:  # /
			j += 1
		var from := j
		while _is_ascii_letter(_at(cps, j)):
			j += 1
		return j + 1 if j > from and _at(cps, j) == 0x3E else i  # >
	if _at(cps, i) == 0x26:  # &
		var j := i + 1
		var numeric := _at(cps, j) == 0x23  # &#38;
		if numeric:
			j += 1
		var from := j
		while (_is_ascii_digit(_at(cps, j)) if numeric else _is_ascii_letter(_at(cps, j))):
			j += 1
		return j + 1 if j > from and _at(cps, j) == 0x3B else i  # ;
	return i


## A line broken into the units it would be spoken in, in order, each
## {"kind": "syllable" | "closed" | "pause", "weight": float, "start": int, "end": int}, offsets in code points,
## end exclusive. `locale` is the language the line is spoken in (the project's main language, not the one being
## shown); it decides English's and French's silent e, and Japanese kanji, which also apply when the line has any
## kana in it.
static func units(text: String, locale: String = "") -> Array:
	var n := text.length()
	var cps := PackedInt32Array()
	var cls := PackedInt32Array()
	cps.resize(n)
	cls.resize(n)
	var japanese := false
	for j in n:
		cps[j] = text.unicode_at(j)
		cls[j] = class_of(cps[j])
		if cls[j] in KANA_CLASSES:
			japanese = true
	var lang := _language_of(locale)
	if lang == "ja":
		japanese = true
	var out: Array = []
	var i := 0
	while i < n:
		var k := cls[i]
		var skip := _markup_end(cps, i)
		if skip > i:
			i = skip
			continue
		if k in LATIN:
			var end := _word_end(cls, i, LATIN)
			# Each vowel group's last vowel, and how many vowels it has (a mark inside a group continues it).
			var lasts: Array[int] = []
			var sizes: Array[int] = []
			var in_group := false
			for j in range(i, end):
				if cls[j] == K.LATIN_VOWEL:
					if in_group:
						lasts[-1] = j
						sizes[-1] += 1
					else:
						lasts.append(j)
						sizes.append(1)
					in_group = true
				elif cls[j] != K.MARK:
					in_group = false
			if lasts.size() >= 2 and sizes[-1] == 1 and _silent_e(cps, cls, i, end, lasts[-1], lang):
				lasts.pop_back()
			_from_anchors(out, cls, i, end, lasts if not lasts.is_empty() else [end - 1])
			i = end
		elif k in CYRILLIC:
			var end := _word_end(cls, i, CYRILLIC)
			var vowels: Array[int] = []
			for j in range(i, end):
				if cls[j] == K.CYRILLIC_VOWEL:
					vowels.append(j)
			_from_anchors(out, cls, i, end, vowels if not vowels.is_empty() else [end - 1])
			i = end
		elif k in ARABIC:
			var end := _word_end(cls, i, ARABIC)
			var vowels: Array[int] = []
			var letters: Array[int] = []
			for j in range(i, end):
				if cls[j] == K.ARABIC_VOWEL:
					vowels.append(j)
				elif cls[j] == K.ARABIC_LETTER:
					letters.append(j)
			_from_anchors(out, cls, i, end, vowels if not vowels.is_empty() else _spread(letters, maxi(1, ceili(letters.size() / 2.0)), 2))
			i = end
		elif k in THAI:
			var end := _word_end(cls, i, THAI)
			_from_anchors(out, cls, i, end, _thai_anchors(cls, i, end))
			i = end
		elif k in OTHER:
			var end := _word_end(cls, i, OTHER)
			var letters: Array[int] = []
			for j in range(i, end):
				if cls[j] == K.OTHER_LETTER:
					letters.append(j)
			_from_anchors(out, cls, i, end, _spread(letters, maxi(1, ceili(letters.size() / 3.0)), 3))
			i = end
		elif k == K.HAN:
			var end := _marks_end(cls, i + 1)
			out.append(_unit("syllable", PatterBundle.SPEECH_KANJI_WEIGHT if japanese else 1.0, i, end))
			i = end
		elif k == K.KANA or k == K.HANGUL:
			var end := _marks_end(cls, i + 1)
			out.append(_unit("syllable", 1.0, i, end))
			i = end
		elif k == K.KANA_SMALL or k == K.KANA_LONG:
			# A small kana merges with the kana before it; ー holds it for another beat. With none before, a small
			# kana is a mora of its own and ー says nothing.
			var end := _marks_end(cls, i + 1)
			var last: Dictionary = out[-1] if not out.is_empty() else {}
			if last.get("kind", "") == "syllable" and last.get("end", -1) == i:
				last["end"] = end
				if k == K.KANA_LONG:
					last["weight"] += 1.0
			elif k == K.KANA_SMALL:
				out.append(_unit("syllable", 1.0, i, end))
			i = end
		elif k == K.KANA_SOKUON:
			var end := _marks_end(cls, i + 1)
			out.append(_unit("closed", 1.0, i, end))
			i = end
		elif k == K.DIGIT:
			var end := _marks_end(cls, i + 1)
			out.append(_unit("syllable", PatterBundle.SPEECH_DIGIT_WEIGHT, i, end))
			i = end
		elif k == K.PAUSE_SHORT or k == K.PAUSE_LONG:
			# A full stop or comma between digits is part of the number (3.5, 1,000).
			var in_number := (cps[i] == 0x2E or cps[i] == 0x2C) and _class_at(cls, i - 1) == K.DIGIT and _class_at(cls, i + 1) == K.DIGIT
			if not in_number:
				out.append(_unit("pause", PatterBundle.SPEECH_PAUSE_LONG_WEIGHT if k == K.PAUSE_LONG else PatterBundle.SPEECH_PAUSE_SHORT_WEIGHT, i, i + 1))
			i += 1
		elif k == K.SPACE:
			# Thai separates its phrases with a space, so a space between Thai words is a short pause.
			var end := i + 1
			while end < n and cls[end] == K.SPACE:
				end += 1
			if _thai_before(cls, i - 1) and _class_at(cls, end) in THAI:
				out.append(_unit("pause", PatterBundle.SPEECH_PAUSE_SHORT_WEIGHT, i, end))
			i = end
		else:
			i += 1  # nothing: a symbol, an emoji, a stray mark or apostrophe
	return _tidy_pauses(out)


## How many syllables a line would be spoken in: its syllables' and shut beats' weights, pauses aside.
static func count(text: String, locale: String = "") -> float:
	var total := 0.0
	for u in units(text, locale):
		if u["kind"] != "pause":
			total += float(u["weight"])
	return total


static func _unit(kind: String, weight: float, start: int, end: int) -> Dictionary:
	return {"kind": kind, "weight": weight, "start": start, "end": end}


static func _class_at(cls: PackedInt32Array, j: int) -> int:
	return cls[j] if j >= 0 and j < cls.size() else K.NONE


## A character's own unit runs on over the marks after it.
static func _marks_end(cls: PackedInt32Array, j: int) -> int:
	while j < cls.size() and cls[j] == K.MARK:
		j += 1
	return j


## Where a word of these classes starting at `i` ends: marks continue it, and an apostrophe between two of its
## letters joins it.
static func _word_end(cls: PackedInt32Array, i: int, family: Array) -> int:
	var n := cls.size()
	var j := i + 1
	while j < n and (cls[j] in family or cls[j] == K.MARK or (cls[j] == K.JOINER and _class_at(cls, j + 1) in family)):
		j += 1
	return j


## Units for a word from [start, end) and the positions that close each syllable: each unit runs from just after
## the one before to its own position, the first from the word's start and the last to its end. A syllable's last
## letter takes the marks after it (é written as e and a mark).
static func _from_anchors(out: Array, cls: PackedInt32Array, start: int, end: int, anchors: Array) -> void:
	var sorted: Array[int] = []
	for a in anchors:
		var p: int = mini(_marks_end(cls, a + 1), end) - 1
		if not sorted.has(p):
			sorted.append(p)
	sorted.sort()
	for j in sorted.size():
		var from := start if j == 0 else sorted[j - 1] + 1
		var to := end if j == sorted.size() - 1 else sorted[j] + 1
		out.append(_unit("syllable", 1.0, from, to))


## Positions that pick `count` syllables out of a list of letters, every `step` letters (the last at the last
## letter).
static func _spread(letters: Array[int], how_many: int, step: int) -> Array[int]:
	var out: Array[int] = []
	for j in how_many:
		out.append(_at(letters, mini(step * j + step - 1, letters.size() - 1)))
	return out


## Whether the letter before the marks ending at `j` is Thai.
static func _thai_before(cls: PackedInt32Array, j: int) -> bool:
	while j >= 0 and cls[j] == K.MARK:
		j -= 1
	return j >= 0 and cls[j] in THAI


## Whether a Latin word's last vowel group, a single vowel at `e`, is a silent final e: in English, and in French
## (where `-es` is silent too), a lone e ending the word, unless English's consonant + le ("table", "little").
static func _silent_e(cps: PackedInt32Array, cls: PackedInt32Array, start: int, end: int, e: int, lang: String) -> bool:
	if lang != "en" and lang != "fr":
		return false
	if cps[e] != 0x65 and cps[e] != 0x45:  # e, E
		return false
	var after := e + 1
	if after < end and cls[after] == K.MARK:
		return false  # an accented e, written as e and a mark (é)
	if lang == "fr" and after < end and (cps[after] == 0x73 or cps[after] == 0x53):
		after += 1  # -es
	if after != end:
		return false
	if lang == "en" and e - 2 >= start and (cps[e - 1] == 0x6C or cps[e - 1] == 0x4C) and cls[e - 2] == K.LATIN_LETTER:
		return false
	return true


## The positions closing each syllable of a Thai word from [start, end). A vowel counts, unless it follows a vowel
## written before its consonant (เ แ โ ใ ไ) within two consonants, when they're one vowel (เรียน). A run of
## consonants with no vowel between holds one syllable per two of them, beyond the one consonant a syllable starts
## or ends with (ถนน, ขอบคุณ).
static func _thai_anchors(cls: PackedInt32Array, start: int, end: int) -> Array[int]:
	var anchors: Array[int] = []
	var consonants: Array[int] = []  # since the last vowel
	var lead_open := false           # a leading vowel waiting for the vowel signs it takes
	for p in range(start, end):
		var k := cls[p]
		if k == K.THAI_CONSONANT:
			consonants.append(p)
		elif k == K.THAI_LEAD:
			_thai_implicit(anchors, consonants)
			anchors.append(p + 1 if p + 1 < end and cls[p + 1] == K.THAI_CONSONANT else p)
			consonants.clear()
			lead_open = true
		elif k == K.THAI_VOWEL:
			if consonants.is_empty():
				continue
			if lead_open and consonants.size() <= 2:
				lead_open = false
				consonants.clear()
				continue
			_thai_implicit(anchors, consonants)
			anchors.append(p)
			consonants.clear()
			lead_open = false
	if anchors.is_empty():
		var how_many := maxi(1, ceili(consonants.size() / 2.0))
		for j in how_many:
			anchors.append(consonants[mini(2 * j + 1, consonants.size() - 1)] if not consonants.is_empty() else end - 1)
	else:
		_thai_implicit(anchors, consonants)
	return anchors


## A run of consonants with no vowel between: one syllable per two beyond the first.
static func _thai_implicit(anchors: Array[int], consonants: Array[int]) -> void:
	for j in floori((consonants.size() - 1) / 2.0):
		anchors.append(consonants[2 * j + 1])


## Punctuation in a row is one pause, the stronger; a pause before the first syllable or after the last goes.
static func _tidy_pauses(found: Array) -> Array:
	var out: Array = []
	for u in found:
		if u["kind"] == "pause" and not out.is_empty() and out[-1]["kind"] == "pause":
			out[-1]["weight"] = maxf(out[-1]["weight"], u["weight"])
			out[-1]["end"] = u["end"]
		else:
			out.append((u as Dictionary).duplicate())
	while not out.is_empty() and out[0]["kind"] == "pause":
		out.pop_front()
	while not out.is_empty() and out[-1]["kind"] == "pause":
		out.pop_back()
	return out
