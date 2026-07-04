# Bundle helpers: load a compiled .patterc, plus the shared static helpers (ref splitting, property
# defaults, gameId, gameData merge-at-read). The engine reads the parsed bundle Dictionary directly.
class_name PatterBundle


# Parse a compiled .patterc JSON string into the bundle Dictionary. Returns null on error.
static func load_from_string(json: String):
	var parsed = JSON.parse_string(json)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Patterplay: not a valid .patterc bundle")
		return null
	return parsed


# Split a ref ("@name" / "@scope.name") into [scope, lowercased name].
static func split_ref(ref: String) -> Array:
	var body := ref.substr(1) if ref.begins_with("@") else ref
	var dot := body.find(".")
	if dot != -1 and body.find(".", dot + 1) == -1:
		var head := body.substr(0, dot)
		var tail := body.substr(dot + 1)
		if head == "scene" or head == "patter":
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


static func game_data_fields_for(bundle: Dictionary, kind: String) -> Array:
	return bundle.get("gameDataFields", {}).get(kind, [])


# A node's FULL effective gameData: declared fields filled (override or default), override-only orphans
# kept. `node` may be null (pure defaults). Returns a Dictionary {name: value}.
static func effective_game_data(fields: Array, node) -> Dictionary:
	var out := {}
	for f in fields:
		var name = f["name"]
		if node != null and node.has(name):
			out[name] = PatterValues.to_value(node[name])
		elif f.has("default"):
			out[name] = PatterValues.to_value(f["default"])
	if node != null:
		for k in node.keys():
			if not out.has(k):
				out[k] = PatterValues.to_value(node[k])
	return out
