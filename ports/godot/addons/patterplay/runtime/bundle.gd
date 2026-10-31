# Bundle helpers: load a compiled .patterc, plus the shared static helpers (ref splitting, property
# defaults, gameId, gameData merge-at-read). The engine reads the parsed bundle Dictionary directly.
class_name PatterBundle


# Parse a compiled .patterc JSON string into the bundle Dictionary. Returns null on error.
static func load_from_string(json: String):
	var parsed = JSON.parse_string(json)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Patterplay: not a valid .patterc bundle")
		return null
	if parsed.has("externalScopes"):
		var ext = parsed["externalScopes"]
		var ok: bool = ext is Array
		if ok:
			for t in ext:
				ok = ok and t is String
		if not ok:
			push_error("Patterplay: a .patterc bundle's externalScopes must be an array of scope tokens")
			return null
	return parsed


## Other engines' game-wide scopes the content names (`story`), sorted, from the bundle's
## "externalScopes": the family's shared vocabulary, which the compiler lets through unchecked and
## never self-backs. [] when the bundle names none (the key is absent then).
static func external_scopes(bundle: Dictionary) -> Array:
	var out: Array = []
	var ext = bundle.get("externalScopes")
	if ext is Array:
		for t in ext:
			if t is String and t != "":
				out.append(t)
	return out


# Split a ref ("@name" / "@scope.name") into [scope, lowercased name], asking `is_scope(token) -> bool`
# which heads are scopes. The engine asks its registry, so a scope another engine registered (`@story`)
# splits as one too; without that, "@world.gold" would split to a @patter property literally named
# "world.gold", which reads as absent and takes the falsy branch in silence. Mirrors the JS dialect's
# splitRef(ref, isScope).
static func split_ref_with(ref: String, is_scope: Callable) -> Array:
	var body := ref.substr(1) if ref.begins_with("@") else ref
	var dot := body.find(".")
	if dot != -1 and body.find(".", dot + 1) == -1:
		var head := body.substr(0, dot)
		var tail := body.substr(dot + 1)
		if is_scope.call(head):
			return [head, tail.to_lower()]
	return ["patter", body.to_lower()]


# The seed value for a property declaration (its default, else the type default): the kernel's
# default_for, one rule with the bags'. A flags default is copied, so a write never edits the declaration.
static func prop_default(decl: Dictionary):
	var v = PatterValues.to_value(PatterPropertyBag.default_for(decl))
	return (v as Array).duplicate() if v is Array else v


static func game_idify(text: String) -> String:
	var s := text.to_lower()
	var tmp := ""
	for i in s.length():
		var c := s[i]
		if c == "'" or c == "’":
			continue
		var keep := (c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "-"
		tmp += c if keep else "-"
	var parts := tmp.split("-", false)  # false = no empty entries
	return "-".join(parts)


static func effective_game_id(decl: Dictionary) -> String:
	var g := str(decl.get("gameId", "")).strip_edges()
	return g if g != "" else game_idify(str(decl.get("name", "")))


# The author-defined gameData fields declared for a node TYPE (empty when none).
static func game_data_fields(bundle: Dictionary, kind: String) -> Array:
	return bundle.get("gameDataFields", {}).get(kind, [])


# One node's effective value for a field: its sparse OVERRIDE if present, else the field's declared
# default (null if neither is set). `fields` is the schema for the node's type: its gameData fields, or
# an extension's declarations for the kind (extension_decls), whose values may be any JSON. `node` may be
# null.
static func game_data_value(fields: Array, node, name: String):
	if node != null and node.has(name):
		return _declared_value(node[name])
	for f in fields:
		if f.get("name", "") == name:
			return _declared_value(f["default"]) if f.has("default") else null
	return null


# A node's FULL effective gameData: declared fields filled (override or default), override-only orphans
# kept. `node` may be null (pure defaults). Returns a Dictionary {name: value}. The same for one
# extension's values, given its declarations (extension_decls): a structured default arrives whole.
static func effective_game_data(fields: Array, node) -> Dictionary:
	var out := {}
	for f in fields:
		var name = f["name"]
		var v = game_data_value(fields, node, name)
		if v != null:
			out[name] = v
	if node != null:
		for k in node.keys():
			if not out.has(k):
				out[k] = _declared_value(node[k])
	return out


# A value as the two helpers above hand it over: a scalar or a flags list normalised the way a step's
# gameData is, and a structured extension value (a record, a map, a list of anything but text) whole, as a
# deep copy, so a host editing what it was handed never edits the bundle.
static func _declared_value(v):
	if v is Dictionary:
		return (v as Dictionary).duplicate(true)
	if v is Array and not (v as Array).all(func(x): return x is String):
		return (v as Array).duplicate(true)
	return PatterValues.to_value(v)


# -- Patter extension values -----------------------------------------------------------------------------
#
# Patter extension values follow gameData's rule (patterkit design/proposals/patter-storylet-extensions.md,
# "At runtime"): raw on the node, declarations with every default resolved in the bundle's "extensions"
# section, and the SAME two helpers above fill them in, given extension_decls. extensions_of reads any
# node's values off the bundle, by the address a game already uses.

## One extension's declarations for a node kind ("project", "scene", "block", "snippet", "line", "text",
## "gameEvent", "option"), every default resolved. Empty when the bundle has no such extension or it
## declares nothing for the kind.
static func extension_decls(bundle: Dictionary, extension: String, kind: String) -> Array:
	var exts = bundle.get("extensions")
	if not (exts is Dictionary) or not (exts.get(extension) is Dictionary):
		return []
	var fields = exts[extension].get("fields")
	if not (fields is Dictionary) or not (fields.get(kind) is Array):
		return []
	return fields[kind]


## A node's Patter extension values, by extension id, raw; {} when it has none or the address names
## nothing. By the names a game already holds: "project" (no address); "scene" by id or gameId; "block" as
## "scene/block", each by id or gameId; "snippet", "line", "text", "gameEvent" and "option" (a group
## directly inside a choice) by node id. A node of another kind than the one asked for reads as none. A
## fresh Dictionary each call.
static func extensions_of(bundle: Dictionary, kind: String, address: String = "") -> Dictionary:
	var scenes = bundle.get("scenes")
	if not (scenes is Dictionary):
		scenes = {}
	match kind:
		"project":
			var out := {}
			var exts = bundle.get("extensions")
			if exts is Dictionary:
				for id in exts:
					if exts[id] is Dictionary and exts[id].has("project"):
						out[id] = exts[id]["project"]
			return out
		"scene":
			return _ext_values(_ext_scene(scenes, address))
		"block":
			var slash := address.find("/")
			if slash < 0:
				return {}
			var blocks: Array = _ext_scene(scenes, address.substr(0, slash)).get("blocks", [])
			var ref := address.substr(slash + 1)
			for b in blocks:
				if b is Dictionary and b.get("id") == ref:
					return _ext_values(b)
			for b in blocks:
				if b is Dictionary and effective_game_id(b) == ref:
					return _ext_values(b)
			return {}
		"snippet", "option", "line", "text", "gameEvent":
			for sid in scenes:
				for block in scenes[sid].get("blocks", []):
					var found = _ext_find(block.get("children", []), false, kind, address)
					if found != null:
						return _ext_values(found)
			return {}
	return {}


# A scene by internal id, else by gameId; {} when neither names one.
static func _ext_scene(scenes: Dictionary, ref: String) -> Dictionary:
	if scenes.get(ref) is Dictionary:
		return scenes[ref]
	for sid in scenes:
		if effective_game_id(scenes[sid]) == ref:
			return scenes[sid]
	return {}


# The node of `kind` with id `address` among `children` and below, in document order, or null. An option
# is a group directly inside a choice; its prompt beat counts as a line or text.
static func _ext_find(children: Array, in_choice: bool, kind: String, address: String):
	for node in children:
		if not (node is Dictionary):
			continue
		if node.get("type", "") == "group":
			if in_choice and node.get("id") == address and kind == "option":
				return node
			var prompt = node.get("prompt")
			if in_choice and prompt is Dictionary and prompt.get("id") == address and prompt.get("kind") == kind:
				return prompt
			var inner = _ext_find(node.get("children", []), node.get("selector", "") == "choice", kind, address)
			if inner != null:
				return inner
			continue
		if node.get("id") == address and kind == "snippet":
			return node
		for beat in node.get("beats", []):
			if beat is Dictionary and beat.get("id") == address:
				return beat if beat.get("kind") == kind else null
	return null


# A shallow copy, so a host editing what it was handed never edits the bundle.
static func _ext_values(node) -> Dictionary:
	var values = node.get("extensions") if node is Dictionary else null
	return (values as Dictionary).duplicate() if values is Dictionary else {}


# -- speaker labels --------------------------------------------------------------

## The speaker pattern a project starts with, `You (V.O.)`: the fallback when a bundle carries no
## "speakerPattern" and no locale holds the `speaker:pattern` string. `{name}` and `{qualifier}` are plain
## placeholders, never run through line interpolation.
const DEFAULT_SPEAKER_PATTERN := "{name} ({qualifier})"


## A qualified speaker's label: the pattern with its placeholders filled. Every `{name}` and every
## `{qualifier}` is replaced; nothing else in the pattern is read, and a filled-in name is never read again.
## The one composition rule, as every runtime and Patterpad have it.
static func format_speaker_label(pattern: String, name: String, qualifier: String) -> String:
	var parts := PackedStringArray()
	for part in pattern.split("{name}"):
		parts.append(part.replace("{qualifier}", qualifier))
	return name.join(parts)


# -- line padding ----------------------------------------------------------------

## The built-in `padAfter`, in seconds, for a project that sets no default of its own: the same on every
## runtime and in Patterpad's Play window.
const DEFAULT_PAD_AFTER := 0.6

## How many syllables a second a line with no recording is timed at, unless the project sets its own
## ("estimateSyllablesPerSecond"), and the range validation keeps a project's within.
const DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND := 4.0
const ESTIMATE_SYLLABLES_PER_SECOND_MIN := 2.0
const ESTIMATE_SYLLABLES_PER_SECOND_MAX := 10.0
## The shortest and longest a line with no recording lasts, in seconds.
const LINE_DURATION_MIN := 1.5
const LINE_DURATION_MAX := 18.0

## A digit's weight in speech_units: most read as one or two syllables.
const SPEECH_DIGIT_WEIGHT := 1.5
## A Han character's weight in Japanese text.
const SPEECH_KANJI_WEIGHT := 2.0
## A short pause's weight (`,` `;` `、`), and a long one's (`.` `?` `。`).
const SPEECH_PAUSE_SHORT_WEIGHT := 1.0
const SPEECH_PAUSE_LONG_WEIGHT := 2.0


## How long a line with no recording lasts, in seconds: the total weight of its speech units (its syllables and its
## pauses, speech_units) at `syllables_per_second` (default 4, the project's "estimateSyllablesPerSecond" when it
## sets one, a line step's "estimateRate"), clamped to 1.5 to 18 seconds. `text` and `locale` are the line as it's
## spoken, in the project's main language (a line step's "spokenText" and "spokenLocale"), never a translation
## being shown. This is the one rule every Patter tool and runtime times a line by, held to the same numbers by the
## conformance corpus. A rate that isn't a positive number is the default. A line with a recording lasts as long as
## the recording, whatever this says.
static func estimate_line_duration(text: String, locale: String = "", syllables_per_second: float = DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND) -> float:
	var rate := syllables_per_second if is_finite(syllables_per_second) and syllables_per_second > 0.0 else DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND
	var weight := 0.0
	for u in PatterSpeech.units(text, locale):
		weight += float(u["weight"])
	return clampf(weight / rate, LINE_DURATION_MIN, LINE_DURATION_MAX)


## A line broken into the units it would be spoken in: its syllables, its beats with the mouth shut, and its
## pauses, in order, each {"kind": "syllable" | "closed" | "pause", "weight": float, "start": int, "end": int},
## the offsets in code points (end exclusive). Lay them over a line's length (its recording's, or
## estimate_line_duration's) to move a mouth: a syllable opens it, "closed" (っ) and a pause keep it shut.
## `locale` is the language the line is spoken in (the project's main language, a step's "spokenLocale"); it
## decides English's and French's silent e, and Japanese kanji.
static func speech_units(text: String, locale: String = "") -> Array:
	return PatterSpeech.units(text, locale)


## How many syllables a line would be spoken in: its syllables' and shut beats' weights, pauses aside. `locale` is
## the language it's spoken in, as for speech_units.
static func count_syllables(text: String, locale: String = "") -> float:
	return PatterSpeech.count(text, locale)


# Line padding: the pause after a line or text beat, `padAfter`, in seconds. A beat without its own takes
# the nearest `padAfterDefault` above it (snippet, then each group, innermost first, then block, then
# scene), else the project's (the bundle root's), else DEFAULT_PAD_AFTER. A snippet's last line or text
# beat can't be cut in on (what follows the seam isn't certain), so a negative value there is clamped to
# zero. A negative pause before a game event stands: the event starts as the line ends. An option's prompt
# resolves through the option, and is never clamped (its reply is certain).
#
# The answer depends only on where a beat sits, so it is worked out once into a flat index:
# beat id -> {"resolved": float, "own": float only when the beat sets one}. Mirrors the JS buildPadIndex.
static func build_pad_index(bundle: Dictionary) -> Dictionary:
	var index := {}
	var project_default := _pad_or(bundle.get("padAfterDefault"), DEFAULT_PAD_AFTER)
	var scenes: Dictionary = bundle.get("scenes", {})
	for sid in scenes:
		var scene: Dictionary = scenes[sid]
		var scene_default := _pad_or(scene.get("padAfterDefault"), project_default)
		for block in scene.get("blocks", []):
			var block_default := _pad_or(block.get("padAfterDefault"), scene_default)
			for child in block.get("children", []):
				_index_pads(index, child, block_default)
	return index


## A pause value as a bundle holds it: a finite number, else `inherited` (anything else, which validation
## refuses, inherits). Mirrors the JS num().
static func _pad_or(v, inherited: float) -> float:
	return float(v) if _is_pad(v) else inherited


static func _is_pad(v) -> bool:
	var t := typeof(v)
	if t == TYPE_INT:
		return true
	return t == TYPE_FLOAT and is_finite(v)


static func _index_pads(index: Dictionary, node: Dictionary, inherited: float) -> void:
	var def := _pad_or(node.get("padAfterDefault"), inherited)
	if node.get("type", "") == "group":
		if node.get("prompt") is Dictionary:
			_set_pad(index, node["prompt"], def, false)
		for child in node.get("children", []):
			_index_pads(index, child, def)
		return
	# Only the snippet's last line or text beat (a game event doesn't count) is clamped: the seam.
	var beats: Array = node.get("beats", [])
	var last := -1
	for i in beats.size():
		if _spoken(beats[i]):
			last = i
	for i in beats.size():
		if _spoken(beats[i]):
			_set_pad(index, beats[i], def, i == last)


static func _spoken(beat: Dictionary) -> bool:
	var kind = beat.get("kind", "")
	return kind == "line" or kind == "text"


static func _set_pad(index: Dictionary, beat: Dictionary, inherited: float, clamp_last: bool) -> void:
	var raw = beat.get("padAfter") if beat.get("kind", "") != "gameEvent" else null
	var has_own := _is_pad(raw)
	var resolved := float(raw) if has_own else inherited
	if clamp_last and resolved < 0.0:
		resolved = 0.0
	var pad := {"resolved": resolved}
	if has_own:
		pad["own"] = float(raw)
	index[beat["id"]] = pad
