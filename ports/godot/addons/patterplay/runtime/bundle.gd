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


# The seed value for a property declaration (its default, else the type default).
static func prop_default(decl: Dictionary):
	if decl.has("default"):
		return PatterValues.to_value(decl["default"])
	match decl.get("type", ""):
		"boolean":
			return false
		"number":
			return 0.0
		"string":
			return ""
		"flags":
			return []
		"enum":
			var vals: Array = decl.get("values", [])
			return vals[0] if not vals.is_empty() else ""
		"quality":
			# The ladder's start: a quality seeds at its FIRST stage.
			var stages: Array = decl.get("stages", [])
			return stages[0] if not stages.is_empty() else ""
	return false


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


## Deprecated: use game_data_fields, the name every Patterplay runtime uses. Goes in a later release.
static func game_data_fields_for(bundle: Dictionary, kind: String) -> Array:
	return game_data_fields(bundle, kind)


# One node's effective value for a field: its sparse OVERRIDE if present, else the field's declared
# default (null if neither is set). `fields` is the schema for the node's type; `node` may be null.
static func game_data_value(fields: Array, node, name: String):
	if node != null and node.has(name):
		return PatterValues.to_value(node[name])
	for f in fields:
		if f.get("name", "") == name:
			return PatterValues.to_value(f["default"]) if f.has("default") else null
	return null


# A node's FULL effective gameData: declared fields filled (override or default), override-only orphans
# kept. `node` may be null (pure defaults). Returns a Dictionary {name: value}.
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
				out[k] = PatterValues.to_value(node[k])
	return out


# -- line padding ----------------------------------------------------------------

## The built-in `padAfter`, in seconds, for a project that sets no default of its own: the same on every
## runtime and in Patterpad's Play window.
const DEFAULT_PAD_AFTER := 0.6


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
