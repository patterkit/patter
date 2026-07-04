# PatterEngine - the world + flow manager: shared @patter / @scene state, visit counts, and
# whole-game save/load. Port of engine.ts's Engine (via the corpus-verified C#/C++ ports).
#
#   var engine := PatterEngine.new(bundle)            # bundle = PatterBundle.load_from_string(json)
#   var flow := engine.open_flow("main", "demo")
#   var step := flow.advance()                         # { "type": "line"/"text"/"choice"/"end", ... }
class_name PatterEngine
extends RefCounted

var _host: Dictionary
var _default_seed: int = 0x9e3779b9
var _flows: Dictionary = {}
var _scene_gameid_to_id: Dictionary = {}
var _block_gameid_to_id: Dictionary = {}
var _source_debug: bool = false  # source-only DEBUG build: strings are the source language, not shippable
# The options this engine was built with - reused verbatim by hot_swap() so the replacement engine
# keeps the same seed source and settings.
var _creation_options: Dictionary = {}


func _init(bundle: Dictionary, options: Dictionary = {}) -> void:
	_creation_options = options
	var locale: String = options.get("locale", "")
	if locale == "":
		locale = bundle["locales"]["default"]
	var all_strings: Dictionary = bundle.get("strings", {})
	# Localisation mode (spec §11): "ids" + no source-debug -> emit beat IDs + omit character names.
	var loc: Dictionary = bundle.get("localisation", {})
	var emit_ids: bool = loc.get("mode", "embedded") == "ids" and not loc.get("sourceDebug", false)
	_source_debug = loc.get("mode", "embedded") == "ids" and loc.get("sourceDebug", false)

	_host = {
		"bundle": bundle,
		"all_strings": all_strings,                 # kept so set_locale() can re-point the active table live
		"locale": locale,
		"emit_ids": emit_ids,
		"strings": all_strings.get(locale, {}),
		"default_strings": all_strings.get(bundle["locales"]["default"], {}),
		"cast_display": {},
		"node_index": {},
		"block_to_scene": {},
		"block_by_id": {},
		"tag_index": {},
		"shared_patter": {},
		"patter_shared_decls": [],
		"patter_local_decls": [],
		"patter_shared_names": {},
		"scene_shared_names": {},
		"shared_visits": {},
		"shared_selectors": {},
		"stage_bags": {},
		"custom_rng": options.get("rng"),
		"replay_prompt_on_choose": options.get("replay_prompt_on_choose", false),
		# Closed captions (#214): captions_on shows cues in dialogue lines (default true); when false the
		# engine strips caption_open..caption_close spans from line text. Mutable via set_closed_captions.
		"captions_on": options.get("closed_captions", true),
		"caption_open": bundle.get("closedCaptions", {}).get("open", "["),   # default: square brackets (#214)
		"caption_close": bundle.get("closedCaptions", {}).get("close", "]"),
		# A cast member whose whole lines are captions (silent when off); absent/empty -> the default SFX.
		"caption_character": bundle.get("closedCaptions", {}).get("character", "SFX"),
	}
	if str(_host["caption_character"]) == "":
		_host["caption_character"] = "SFX"

	if _source_debug:
		push_warning("[Patterplay] source-only DEBUG build: strings are the source language for debugging, not a shippable localised build.")

	for c in bundle.get("cast", []):
		if str(c.get("displayName", "")) != "":
			_host["cast_display"][c["name"]] = c["displayName"]

	if options.has("seed"):
		_default_seed = int(options["seed"]) & 0xffffffff

	for sid in bundle["scenes"].keys():
		var scene: Dictionary = bundle["scenes"][sid]
		_scene_gameid_to_id[PatterBundle.effective_game_id(scene)] = sid
		var block_addrs := {}
		# Author tags (#215): accumulate scene -> block -> node (own + ancestors), deduped, outermost-first.
		var scene_tags: Array = _dedupe_tags(scene.get("tags", []))
		_host["tag_index"][sid] = scene_tags
		for block in scene["blocks"]:
			_host["block_to_scene"][block["id"]] = sid
			_host["block_by_id"][block["id"]] = block
			block_addrs[PatterBundle.effective_game_id(block)] = block["id"]
			var block_tags: Array = _dedupe_tags(scene_tags + block.get("tags", []))
			_host["tag_index"][block["id"]] = block_tags
			_index_nodes(block.get("children", []))
			_index_tags(block.get("children", []), block_tags)
		_block_gameid_to_id[sid] = block_addrs

	for p in bundle.get("properties", []):
		var shared: bool = p.get("shared", true)
		if shared:
			_host["patter_shared_decls"].append(p)
			_host["patter_shared_names"][str(p["name"]).to_lower()] = true
		else:
			_host["patter_local_decls"].append(p)
	for d in _host["patter_shared_decls"]:
		_host["shared_patter"][str(d["name"]).to_lower()] = PatterBundle.prop_default(d)

	for sid in bundle["scenes"].keys():
		var names := {}
		for p in bundle["scenes"][sid].get("sceneProps", []):
			if p.get("shared", false):
				names[str(p["name"]).to_lower()] = true
		_host["scene_shared_names"][sid] = names


func _index_nodes(nodes: Array) -> void:
	for n in nodes:
		_host["node_index"][n["id"]] = n
		if n.get("type", "") == "group":
			_index_nodes(n.get("children", []))


# Author tags (#215): walk groups/snippets carrying the parent's accumulated tags; record each node's and
# (for snippets) each beat's accumulated tags into the tag index.
func _index_tags(nodes: Array, inherited: Array) -> void:
	for n in nodes:
		var acc: Array = _dedupe_tags(inherited + n.get("tags", []))
		_host["tag_index"][n["id"]] = acc
		if n.get("type", "") == "group":
			_index_tags(n.get("children", []), acc)
		else:
			for beat in n.get("beats", []):
				_host["tag_index"][beat["id"]] = _dedupe_tags(acc + beat.get("tags", []))


# Dedupe a tag list, preserving first-seen order.
func _dedupe_tags(tags: Array) -> Array:
	var seen := {}
	var out: Array = []
	for t in tags:
		if not seen.has(t):
			seen[t] = true
			out.append(t)
	return out


func open_flow(id: String, scene: String = "", block: String = "", seed_value = null) -> PatterFlow:
	var scene_id := _resolve_scene_ref(scene)
	var block_id := _resolve_block_ref(scene_id, block)
	var flow := PatterFlow.new(_host, int(seed_value) if seed_value != null else _default_seed)
	_flows[id] = flow
	flow.start(scene_id, block_id)
	return flow


func get_flow(id: String) -> PatterFlow:
	return _flows.get(id)


func close_flow(id: String) -> void:
	_flows.erase(id)


func reset() -> void:
	_flows = {}
	_host["shared_patter"] = {}
	for d in _host["patter_shared_decls"]:
		_host["shared_patter"][str(d["name"]).to_lower()] = PatterBundle.prop_default(d)
	_host["shared_visits"] = {}
	_host["shared_selectors"] = {}
	_host["stage_bags"] = {}


func locale() -> String:
	return _host["locale"]


# The compiled bundle's build hash (content.hash). Pass it to PatterDebugLink so Patterpad's live
# debug link can tell whether the running game matches the currently open project (in-sync vs stale).
func build_id() -> String:
	return str(_host["bundle"].get("content", {}).get("hash", ""))


# True for a source-only DEBUG build: the embedded strings are the source language (for debugging), not a
# shippable localised build. An IDs-only ship build is false.
func is_source_debug() -> bool:
	return _source_debug


# Switch the active locale LIVE - subsequent string lookups (new beats, character names, {@ref}) render in
# it; flow position / state / visits / rng are untouched. All open flows share the host string table, so the
# swap reaches them at once. A locale with no table resolves every string via the <Untranslated> fallback.
func set_locale(locale: String) -> void:
	_host["locale"] = locale
	_host["strings"] = _host["all_strings"].get(locale, {})


# Live bundle refresh, tier 1 (strings only): swap every locale's string table in place from a freshly
# compiled bundle whose STRUCTURE is unchanged (same content.structureHash). Like set_locale, nothing
# restarts and no flow is touched: the next delivered beat reads the new text. Structural edits need
# hot_swap() instead (a structure change here simply won't show).
func replace_strings(bundle: Dictionary) -> void:
	var all_strings: Dictionary = bundle.get("strings", {})
	_host["all_strings"] = all_strings
	_host["strings"] = all_strings.get(_host["locale"], {})
	_host["default_strings"] = all_strings.get(_host["bundle"]["locales"]["default"], {})


# Live bundle refresh, tier 2 (full swap): rebuild on an edited bundle with the whole run carried over
# (save_game -> fresh engine -> load_game) plus the presentation state that isn't save state (active
# locale, captions toggle). Content drift resolves per spec 9.8: stack frames re-find their next child
# by id, drifted options drop, a vanished snippet is skipped. Returns the REPLACEMENT engine; discard
# this one and re-bind flow handles via next.get_flow(id).
func hot_swap(bundle: Dictionary) -> PatterEngine:
	var snapshot := save_game()
	var next := PatterEngine.new(bundle, _creation_options)
	next.load_game(snapshot)
	next.set_locale(_host["locale"])
	next.set_closed_captions(_host["captions_on"])
	return next


# Live bundle refresh - the applier for a bundle the editor pushed over the debug link (the
# GDScript parity of @patterkit/play-helpers' applyLiveBundle). Picks the tier itself by comparing
# content.structureHash: same structure -> replace_strings (tier 1, THIS engine, nothing restarts);
# changed structure -> hot_swap (tier 2, a REPLACEMENT engine - re-bind flow handles via
# get_flow). Returns { "engine": PatterEngine, "kind": "text"|"structure"|"error" }; on "error"
# (unparseable json) the engine is untouched. Wire-up:
#
#   link.bundle_pushed.connect(func(build: String, data: String) -> void:
#       var r := engine.apply_live_bundle(data)
#       if r["kind"] == "structure":
#           engine = r["engine"]
#           flow = engine.get_flow("main")
#       if r["kind"] != "error":
#           link.set_build(build))
func apply_live_bundle(data: String) -> Dictionary:
	var next = PatterBundle.load_from_string(data)
	if next == null:
		return {"engine": self, "kind": "error"}
	var cur: String = str((_host["bundle"] as Dictionary).get("content", {}).get("structureHash", ""))
	var nxt: String = str((next as Dictionary).get("content", {}).get("structureHash", ""))
	if cur != "" and cur == nxt:
		replace_strings(next)
		return {"engine": self, "kind": "text"}
	return {"engine": hot_swap(next), "kind": "structure"}


# Whether closed captions are currently shown (full dialogue text).
func closed_captions() -> bool:
	return _host["captions_on"]


# Turn closed captions on/off LIVE (#214). When OFF, subsequent dialogue lines have their caption cues +
# surrounding whitespace stripped; narration / prompts / etc. untouched. A presentation toggle reaching
# every open flow at once; not save state.
func set_closed_captions(on: bool) -> void:
	_host["captions_on"] = on


func get_property(ref: String):
	var sp := PatterBundle.split_ref(ref)
	if sp[0] == "scene":
		push_error("'%s': @scene properties are scene-scoped - read/write them on a Flow" % ref)
		return null
	return _host["shared_patter"].get(sp[1])


# Editable @patter properties (the shared / engine-scoped ones), for a live inspector.
# Each row: { "ref":"@name", "type":, "value":, "default":, "values":[enum opts] }. Parity with
# the Unity PatterStateWindow property inspector.
func list_properties() -> Array:
	var rows: Array = []
	for d in _host["patter_shared_decls"]:
		var nm: String = str(d["name"]).to_lower()
		rows.append({
			"ref": "@" + nm,
			"type": d.get("type", "boolean"),
			"value": _host["shared_patter"].get(nm),
			"default": PatterBundle.prop_default(d),
			"values": d.get("values", []),
		})
	return rows


func set_property(ref: String, value) -> void:
	var sp := PatterBundle.split_ref(ref)
	if sp[0] == "scene":
		push_error("'%s': @scene properties are scene-scoped - read/write them on a Flow" % ref)
		return
	_host["shared_patter"][sp[1]] = value


# -- save / load ---------------------------------------------------------------

func save_game() -> Dictionary:
	var flows := {}
	for id in _flows.keys():
		flows[id] = _flows[id].snapshot()
	return {
		"version": 2,
		"shared": _host["shared_patter"].duplicate(true),
		"shared_visits": _host["shared_visits"].duplicate(true),
		"shared_selectors": _host["shared_selectors"].duplicate(true),
		"stage_bags": _host["stage_bags"].duplicate(true),
		"flows": flows,
	}


func load_game(save: Dictionary) -> void:
	if save.get("version", 0) != 2:
		push_error("unsupported save version")
		return
	_host["shared_patter"] = (save["shared"] as Dictionary).duplicate(true)
	_host["shared_visits"] = (save["shared_visits"] as Dictionary).duplicate(true)
	_host["shared_selectors"] = (save["shared_selectors"] as Dictionary).duplicate(true)
	_host["stage_bags"] = (save["stage_bags"] as Dictionary).duplicate(true)
	_flows = {}
	for id in (save["flows"] as Dictionary).keys():
		var flow := PatterFlow.new(_host, _default_seed)
		flow.restore(save["flows"][id])
		_flows[id] = flow


# -- ref resolution ------------------------------------------------------------

func _resolve_scene_ref(r: String) -> String:
	if r == "":
		return ""
	if _host["bundle"]["scenes"].has(r):
		return r
	return _scene_gameid_to_id.get(r, r)


func _resolve_block_ref(scene_id: String, r: String) -> String:
	if r == "":
		return ""
	if _host["block_by_id"].has(r):
		return r
	if scene_id != "" and _block_gameid_to_id.has(scene_id):
		var m: Dictionary = _block_gameid_to_id[scene_id]
		if m.has(r):
			return m[r]
	return r


# Author tags (#215): a beat's accumulated tags (own + every ancestor's), the same value its step carries.
# Empty array for an unknown id or a beat with no tags anywhere up the chain.
func tags_for_beat(beat_id: String) -> Array:
	return _host["tag_index"].get(beat_id, [])


# A scene's own tags, by internal id or gameId address.
func tags_for_scene(scene_ref: String) -> Array:
	return _host["tag_index"].get(_resolve_scene_ref(scene_ref), [])


# A block's accumulated tags (scene + block), by scene + block ref (id or gameId).
func tags_for_block(scene_ref: String, block_ref: String) -> Array:
	var scene_id := _resolve_scene_ref(scene_ref)
	return _host["tag_index"].get(_resolve_block_ref(scene_id, block_ref), [])


# -- static structure introspection (editor / dev tooling) ---------------------

# The authored structure as a nested tree: scenes -> blocks -> children (groups + snippets, groups
# preserved) -> a snippet's beats. Static (no flow); per-beat data at the source locale. For dev
# tooling that builds against the writer's structure (see also get_beat_sequence()).
func get_outline() -> Array:
	var out: Array = []
	for sid in _host["bundle"]["scenes"].keys():
		var scene: Dictionary = _host["bundle"]["scenes"][sid]
		var os := {
			"id": scene["id"],
			"gameId": PatterBundle.effective_game_id(scene),
			"name": scene.get("name", ""),
			"blocks": [],
		}
		var st: Array = _host["tag_index"].get(scene["id"], [])
		if not st.is_empty():
			os["tags"] = st
		for block in scene["blocks"]:
			var ob := {
				"id": block["id"],
				"gameId": PatterBundle.effective_game_id(block),
				"name": block.get("name", ""),
				"children": [],
			}
			var bt: Array = _host["tag_index"].get(block["id"], [])
			if not bt.is_empty():
				ob["tags"] = bt
			for n in block.get("children", []):
				ob["children"].append(_outline_node(n))
			os["blocks"].append(ob)
		out.append(os)
	return out


# Every beat in document order, flattened through groups, each with the scene/block/snippet it belongs
# to and its static data. The linear view of get_outline(), for a tool that lays one item per beat.
func get_beat_sequence() -> Array:
	var seq: Array = []
	for sid in _host["bundle"]["scenes"].keys():
		var scene: Dictionary = _host["bundle"]["scenes"][sid]
		for block in scene["blocks"]:
			_collect_beats(block.get("children", []), scene["id"], block["id"], seq)
	return seq


func _collect_beats(nodes: Array, scene_id: String, block_id: String, into: Array) -> void:
	for n in nodes:
		if n.get("type", "") == "group":
			_collect_beats(n.get("children", []), scene_id, block_id, into)
			continue
		for beat in n.get("beats", []):
			into.append({
				"sceneId": scene_id,
				"blockId": block_id,
				"snippetId": n["id"],
				"beat": _beat_info(beat),
			})


func _outline_node(n: Dictionary) -> Dictionary:
	if n.get("type", "") == "group":
		var g := {"type": "group", "id": n["id"], "children": []}
		var gt: Array = _host["tag_index"].get(n["id"], [])
		if not gt.is_empty():
			g["tags"] = gt
		if n.has("selector"):
			g["selector"] = n["selector"]
		if n.has("prompt"):
			g["prompt"] = _beat_info(n["prompt"])
		for c in n.get("children", []):
			g["children"].append(_outline_node(c))
		return g
	var s := {"type": "snippet", "id": n["id"], "beats": []}
	var stg: Array = _host["tag_index"].get(n["id"], [])
	if not stg.is_empty():
		s["tags"] = stg
	for b in n.get("beats", []):
		s["beats"].append(_beat_info(b))
	if n.has("jump"):
		s["jumpTo"] = n["jump"]["to"]
		if n["jump"].has("mode"):
			s["jumpMode"] = n["jump"]["mode"]
	return s


# One beat's static data (source locale), the same shape a delivered step carries.
func _beat_info(beat: Dictionary) -> Dictionary:
	var kind: String = beat.get("kind", "")
	var info := {"id": beat["id"], "kind": kind}
	if kind == "line":
		if beat.has("character"):
			info["character"] = beat["character"]
			var nm = _host["default_strings"].get("cast:" + str(beat["character"]))
			if nm == null:
				nm = _host["cast_display"].get(beat["character"])
			if nm != null:
				info["characterName"] = nm
		if beat.has("direction"):
			info["direction"] = beat["direction"]
	if kind == "line" or kind == "text":
		var src = _host["default_strings"].get(beat["id"])  # source text, un-interpolated
		if src != null:
			info["text"] = src
	if beat.has("gameData") and not (beat["gameData"] as Dictionary).is_empty():
		info["gameData"] = beat["gameData"]
	var tg: Array = _host["tag_index"].get(beat["id"], [])
	if not tg.is_empty():
		info["tags"] = tg
	return info
