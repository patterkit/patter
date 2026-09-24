# PatterEngine - the world + flow manager: shared @patter / @scene state, visit counts, and
# whole-game save/load. Port of engine.ts's Engine (via the corpus-verified C#/C++ ports).
#
#   var engine := PatterEngine.new(bundle)            # bundle = PatterBundle.load_from_string(json)
#   var flow := engine.open_flow("main", "demo")
#   var step := flow.advance()                         # { "type": "line"/"text"/"choice"/"end", ... }
#
# Every property bag lives in ONE scope registry per game (the one-registry model): the game hands
# the engine its registry ({"registry": PatterScopeRegistry}) or the engine makes its own and acts as
# its own game. `@patter` is registered under `patter`; the per-flow and per-scene bags under keys
# starting `patter/` (see PatterFlow.key_*), which no expression can name. save_game() / load_game()
# snapshot and restore what is NOT a property: cursors, PRNGs, visits, and selectors. The registry's
# values ride in save_game() only when the engine made the registry itself; otherwise the game saves
# the registry once.
class_name PatterEngine
extends RefCounted

## Internal option: a hot_swap replacement of an engine that made its own registry is still its own
## game (it self-backs host scopes and saves the registry's values), though it is handed that
## registry. Not public API.
const _OWNS_REGISTRY := "_owns_registry"

var _host: Dictionary
## Why construction was refused ("" when it was not): see init_error().
var _init_error := ""
var _default_seed: int = 0x9e3779b9
var _flows: Dictionary = {}
var _scene_gameid_to_id: Dictionary = {}
var _block_gameid_to_id: Dictionary = {}
var _source_debug: bool = false  # source-only DEBUG build: strings are the source language, not shippable
# The options this engine was built with - reused verbatim by hot_swap() so the replacement engine
# keeps the same seed source and settings.
var _creation_options: Dictionary = {}

## The run's ordered decision stream; see log().
var _engine_log: Array = []


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
		# The run's decision trace (parity with the JS runtime's engine.log()). Off unless
		# asked for: a shipped game should pay nothing for a surface it never reads.
		"log_enabled": bool(options.get("log", false)),
		# The SHARED array, not a callable closing over `self`. A lambda here would capture the
		# engine, _host holds the lambda, and the engine holds _host: a reference cycle that
		# keeps the engine alive forever and makes the weak debug registry report a dead one.
		# test_debug_registry caught exactly that, which is what it is for.
		"engine_log": _engine_log,
		# Diagnostics hook (opt-in, dev tooling): called with the choice's group id whenever a
		# choice runs dry - no takeable option and no eligible fallback - so the silent
		# fall-through is observable. Parity with the JS runtime's onDryChoice, which the
		# three ports never had. Live feedback, distinct from the log's `dry` entry.
		"on_dry_choice": options.get("on_dry_choice"),
		"bundle": bundle,
		"all_strings": all_strings,                 # kept so set_locale() can re-point the active table live
		"locale": locale,
		"emit_ids": emit_ids,
		"strings": all_strings.get(locale, {}),
		"default_strings": all_strings.get(bundle["locales"]["default"], {}),
		"cast_display": {},
		"node_index": {},
		"block_to_scene": {},
		# Host-facing addresses (spec §6), shared with the engine: scene gameId -> internal id, and
		# per-scene block gameId -> internal id. A flow needs them to resolve goto() by address.
		"scene_gameid_to_id": _scene_gameid_to_id,
		"block_gameid_to_id": _block_gameid_to_id,
		"block_by_id": {},
		"tag_index": {},
		# The game's one registry: `@patter` (the SHARED globals), host scopes, every instance bag.
		# Held untyped: a combined game may hand over a registry another addon's shim built.
		"registry": null,
		# True when the engine made the registry (a standalone game): save_game() then carries its values.
		"owns_registry": false,
		"shared_patter": null,   # the SHARED @patter globals' PatterPropertyBag, registered under `patter`
		# Host scopes this engine self-backed and registered (the game bound none, nobody else had).
		"self_backed": [],
		# Host scopes the game bound through the "host_scopes" option, registered as foreign scopes.
		"bound_scopes": [],
		# Memoised ref splits (ref -> [scope, name]), dropped whenever the registry's scopes move.
		"split_cache": {},
		"split_revision": -1,
		"patter_shared_decls": [],
		"patter_local_decls": [],
		"patter_shared_names": {},
		"scene_shared_names": {},
		"shared_visits": {},
		"shared_selectors": {},
		# Per-scene SHARED scene props, each registered under PatterFlow.key_stage(sceneId). Made the
		# first time any flow needs the scene, so a bag loaded before then waits in the registry and
		# is claimed there.
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
		_default_seed = PatterMulberry32.to_uint32(float(options["seed"]))

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
	# The @patter globals live in a bag, like every other scope: it is what carries the
	# audit hook a state logger pushes from, and the clone guard on a mutable default.
	# "@patter." is the address a row reports; the LOG path is the same here, because
	# there is only one shared globals bag.
	_host["shared_patter"] = PatterPropertyBag.new(_host["patter_shared_decls"], {"path_prefix": "@patter."})

	for sid in bundle["scenes"].keys():
		var names := {}
		for p in bundle["scenes"][sid].get("sceneProps", []):
			if p.get("shared", false):
				names[str(p["name"]).to_lower()] = true
		_host["scene_shared_names"][sid] = names

	_register(bundle, options)


## Register this engine's game-wide scopes in the registry: `@patter`, each host scope the game
## bound through "host_scopes", and (only when the engine is its own game) a self-backed bag for
## every other declared host scope. A refusal (a token another engine or the game already holds)
## removes whatever this constructor had registered, keeping the values, so the game's registry is
## left as it was; the refusal is kept for init_error() and the engine is inert.
func _register(bundle: Dictionary, options: Dictionary) -> void:
	var given = options.get("registry")
	var registry = given if given != null else PatterScopeRegistry.new()
	_host["registry"] = registry
	_host["owns_registry"] = given == null or bool(options.get(_OWNS_REGISTRY, false))
	_host["split_revision"] = registry.revision
	var registered: Array = []
	var refused: String = registry.mount_owned("patter", _host["shared_patter"], {"owner": PatterFlow.OWNER})
	if refused == "":
		registered.append("patter")
	var specs: Array = bundle.get("scopeRegistry", {}).get("scopes", [])
	# A scope the game binds through "host_scopes" is EXTERNAL: the game keeps the values, and the
	# registry reads and writes them through the game's { "get", "set" } resolver but never stores or
	# saves them. Its declarations (types, read-only) come from the bundle. "writable": false binds the
	# story and never the game (the registry's rule, ruled across the family 2026-09-05).
	var bound: Dictionary = options.get("host_scopes", {})
	for token in bound.keys():
		if refused != "":
			break
		var spec := _spec_for(specs, str(token))
		var decls: Array = []
		for d in spec.get("declarations", []):
			decls.append(_host_decl(d, null))
		refused = registry.define_foreign(str(token), bound[token], decls,
			{"writable": spec.get("writable", true) != false, "owner": PatterFlow.OWNER})
		if refused == "":
			registered.append(str(token))
			_host["bound_scopes"].append(str(token))
	# A declared host scope nobody bound. A standalone engine is its own game, so it self-backs the
	# scope: a property bag seeded from the declarations, stored and SAVED by the registry like any
	# other, since only a resolver the game binds is external. Given the GAME's registry the engine
	# registers nothing here: those tokens are the game's to register, or another engine's (a bundle
	# compiled against the Storylet Engine's spec declares `@story`), and self-backing one would clash
	# with its real owner depending only on which engine was built first.
	if _host["owns_registry"]:
		for spec in specs:
			if refused != "":
				break
			var token := str(spec.get("token", ""))
			if token == "" or bound.has(token) or registry.has(token):
				continue
			var decls: Array = []
			for d in spec.get("declarations", []):
				decls.append(_host_decl(d, spec.get("writable")))
			refused = registry.define_owned(token, decls, {"owner": PatterFlow.OWNER})
			if refused == "":
				registered.append(token)
				_host["self_backed"].append(token)
	if refused != "":
		for k in registered:
			registry.remove(k, {"keep": true})   # a clash leaves the game's registry as it was
		_host["self_backed"] = []
		_host["bound_scopes"] = []
		_init_error = refused


static func _spec_for(specs: Array, token: String) -> Dictionary:
	for s in specs:
		if str(s.get("token", "")) == token:
			return s
	return {}


## A host scope declaration as the registry takes it. For a self-backed scope the scope's own
## "writable" default is folded in (`scope_writable`), since an owned bag reads writability per
## declaration. Names fold to lower case in the registry, as the compiler emits every reference
## ("isNight" is read as "isnight").
static func _host_decl(d: Dictionary, scope_writable) -> Dictionary:
	var out := {"name": str(d.get("name", "")), "type": str(d.get("type", ""))}
	for k in ["values", "stages", "default", "writable"]:
		if d.has(k) and d[k] != null:
			out[k] = d[k]
	if not out.has("writable") and scope_writable != null:
		out["writable"] = bool(scope_writable)
	return out


## Why construction was refused, or "" when it was not. A registration the registry turned down (a
## token the game or another engine already holds, named in the message) leaves the game's registry
## as it was and this engine inert: check it after PatterEngine.new(bundle, {"registry": ...}).
func init_error() -> String:
	return _init_error


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


## The run's decisions, in order, each naming the flow it happened in. Empty unless the
## engine was created with {"log": true}. A flow's own log stays flow-local; this is the
## only place a story spanning several flows reads as one sequence.
func log() -> Array:
	return _engine_log


## Drop the retained entries. `seq` does NOT restart, so two reads either side of a clear
## still agree about what came first.
func clear_log() -> void:
	_engine_log.clear()


func open_flow(id: String, scene: String = "", block: String = "", seed_value = null) -> PatterFlow:
	if _init_error != "":
		push_error("open_flow: this engine was refused its registration (%s)" % _init_error)
		return null
	var scene_id := _resolve_scene_ref(scene)
	var block_id := _resolve_block_ref(scene_id, block)
	# Re-opening a name REPLACES it: finish the old flow so a host still holding it cannot keep driving
	# the shared world. Replacing is a reset - contrast run_flow(), which reuses.
	if _flows.has(id):
		_flows[id].close()
	var flow := PatterFlow.new(_host, float(seed_value) if seed_value != null else float(_default_seed))
	# The flow knows its own name. `id` was declared on PatterFlow and never assigned, so it
	# read "" for the life of the port; the JS runtime takes it in the constructor. The trace
	# log needs it (every engine entry names the flow it happened in) and a host reading
	# flow.id was getting nothing.
	flow.id = id
	_flows[id] = flow
	flow.start(scene_id, block_id)
	return flow


## Every currently-open flow. Parity with the JS runtime's flows() and the C# / C++ ports:
## a state logger mounts each flow's own bags, so it has to be able to ask for them.
func flows() -> Array:
	return _flows.values()


func get_flow(id: String) -> PatterFlow:
	return _flows.get(id)


# The host-facing address (Game ID) of a scene by internal id, or "" if unknown. The inverse of the
# address resolution open_flow / goto do - for a host that wants to display, log, or pass back the
# address of where it currently is.
func scene_address(scene_id: String) -> String:
	var scenes: Dictionary = _host["bundle"]["scenes"]
	return PatterBundle.effective_game_id(scenes[scene_id]) if scenes.has(scene_id) else ""


# The host-facing address (Game ID) of a block by internal id, or "" if unknown.
func block_address(block_id: String) -> String:
	var blocks: Dictionary = _host["block_by_id"]
	return PatterBundle.effective_game_id(blocks[block_id]) if blocks.has(block_id) else ""


func close_flow(id: String) -> void:
	# The flow object is FINISHED, not merely unregistered, so a host still holding it cannot keep
	# advancing it into the shared world.
	if _flows.has(id):
		_flows[id].close()
	_flows.erase(id)


# "Play this address and give me everything it produced" - the one-call bark form. The NAMED flow is
# reused if it exists (moved with goto) and opened at the address if not, then run to its next stop.
# Reuse is the point: a flow owns its selector cursors, so a shuffle keeps its bag and a "once each"
# list keeps its place across calls. Empty array = nothing left to play. Pushes an error and returns
# [] if the address does not resolve.
func run_flow(flow_name: String, scene: String, block: String = "") -> Array:
	var f: PatterFlow
	if _flows.has(flow_name):
		f = _flows[flow_name]
		if not f.goto(scene, block):
			push_error("run_flow: address not found: %s%s" % [scene, "" if block == "" else " / " + block])
			return []
	else:
		f = open_flow(flow_name, scene, block)
	return f.advance_to_stop()["played"]


func reset() -> void:
	for fid in _flows:
		_flows[fid].close()  # finish them, don't just forget them; a close removes the flow's bags
	_flows = {}
	# Reseeded IN PLACE: the bag stays the one registered under `patter`, so the registry, a
	# state logger and any eval context keep reading it.
	_host["shared_patter"].reseed(_host["patter_shared_decls"])
	_host["shared_visits"] = {}
	_host["shared_selectors"] = {}
	var reg = _host["registry"]
	for sid in _host["stage_bags"]:
		if reg.has(PatterFlow.key_stage(sid)):
			reg.remove(PatterFlow.key_stage(sid))
	_host["stage_bags"] = {}
	# Values loaded for bags nobody has claimed yet are the old game's too: a flow opened after the
	# reset must not pick them up. Other engines' parked values are theirs, and stay.
	reg.discard_parked("patter/")


## Remove every bag this engine registered, keeping the values parked when `keep` (a live reload
## handing its state to a replacement), and close its flows. The engine is inert afterwards.
func _release(keep: bool) -> void:
	for fid in _flows:
		_flows[fid]._release_bags(keep)
		_flows[fid].close()
	_flows = {}
	if _init_error != "":
		return   # registered nothing: `patter` in this registry is somebody else's
	var reg = _host["registry"]
	for sid in _host["stage_bags"]:
		if reg.has(PatterFlow.key_stage(sid)):
			reg.remove(PatterFlow.key_stage(sid), {"keep": keep})
	_host["stage_bags"] = {}
	for t in ["patter"] + _host["self_backed"]:
		if reg.has(t):
			reg.remove(t, {"keep": keep})
	for t in _host["bound_scopes"]:
		if reg.has(t):
			reg.remove(t)


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
# by id, drifted options drop, a vanished snippet is skipped.
#
# Returns the REPLACEMENT engine, on the same registry. This one hands its bags over (each is removed
# from the registry with its values kept, and the replacement claims them as it registers), its flows
# are closed, and it should be discarded; re-bind flow handles via next.get_flow(id). If the restore
# is refused (defensive: 9.8 makes that unreachable for ordinary edits), the swap falls back to a
# fresh engine with each saved flow restarted from the top of the scene it was in; the shared
# properties carry over.
func hot_swap(bundle: Dictionary) -> PatterEngine:
	var snapshot := save_game()
	# The replacement registers on the SAME registry, and a standalone engine's replacement is still
	# its own game (so its save_game keeps carrying the registry's values).
	var opts := _creation_options.duplicate()
	opts["registry"] = _host["registry"]
	opts[_OWNS_REGISTRY] = _host["owns_registry"]
	_release(true)
	var next := PatterEngine.new(bundle, opts)
	if next.init_error() != "" or not next.load_game(snapshot):
		# A partial load may have mutated `next`: hand its bags back, fall back on a THIRD engine and
		# restart each flow at the top of the scene it was in (dropped when that scene is gone too).
		next._release(true)
		next = PatterEngine.new(bundle, opts)
		var flows: Dictionary = snapshot.get("flows", {})
		for id in flows:
			var sid = (flows[id].get("cursor", {}) as Dictionary).get("currentSceneId")
			if sid == null:
				next.open_flow(str(id))
			elif (bundle.get("scenes", {}) as Dictionary).has(str(sid)):
				next.open_flow(str(id), str(sid))
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


## Read a shared property by ref: a `@patter` global, a host scope, or any scope another engine
## registered in the game's registry. `@scene` refs are refused (they are flow-level).
func get_property(ref: String):
	var sp := PatterFlow.split_host_ref(_host, ref)
	if sp[0] == "scene":
		push_error("'%s': @scene properties are scene-scoped - read/write them on a Flow" % ref)
		return null
	return _host["registry"].get_value(sp[0], sp[1])


# Editable @patter properties (the shared / engine-scoped ones), for a live inspector.
# Each row: { "name":, "path":"@name", "type":, "value":, "default":, "values":[enum opts],
# "stages":[ladder], "writable": }. The shape is @wildwinter/scoperegistry's property row,
# shared with the Storylet Engine: "path" is the addressable reference get_property and
# set_property take, "name" the bare declared name. It was "ref" until 2026-09-01, when the
# JS runtime stopped forking that row type. Parity with
# the Unity PatterStateWindow property inspector.
func list_properties() -> Array:
	var rows: Array = []
	for d in _host["patter_shared_decls"]:
		var nm: String = str(d["name"]).to_lower()
		rows.append({
			"name": nm,
			# The QUALIFIED address, matching what the shared bag composes for every other
			# scope. `@gold` still resolves on input - splitRef defaults an unqualified name to
			# the patter scope - but it is the shorthand, not the address a row reports.
			"path": "@patter." + nm,
			"type": d.get("type", "boolean"),
			"value": _host["shared_patter"].get_value(nm),
			"default": PatterBundle.prop_default(d),
			"values": d.get("values", []),
			"stages": d.get("stages", []),
			"writable": d.get("writable", true),
		})
	return rows


## Write a shared property by ref. The GAME's surface, so it writes with HOST authority: a host
## declaration's "writable": false is the story's promise not to write the value, never a lock on
## the game that owns it. The story's own writes go through the flow, which the registry holds to it.
func set_property(ref: String, value) -> void:
	var sp := PatterFlow.split_host_ref(_host, ref)
	if sp[0] == "scene":
		push_error("'%s': @scene properties are scene-scoped - read/write them on a Flow" % ref)
		return
	# A refusal (an unknown scope, or a resolver with no setter) is push_error'd by the registry.
	_host["registry"].set_value(sp[0], sp[1], value, {"host": true})


# -- save / load ---------------------------------------------------------------

## The SHARED kernel bags with the path each answers to in a log: the @patter globals, and
## one per scene for the shared @scene props. Parity with the Storylet Engine's list_bags -
## it is what a state logger mounts.
##
## A stage bag's LOG path is "@scene:<sceneId>." where its address is "@scene.": a property
## is addressed relative to a flow's current scene, but a log spans scenes and has to say
## which one. That is why a mount may override the bag's own prefix.
##
## load_game() replaces every bag, so re-enumerate after a load.
func list_bags() -> Array:
	var mounts: Array = [{"bag": _host["shared_patter"]}]
	for sid in _host["stage_bags"]:
		mounts.append({"bag": _host["stage_bags"][sid], "path_prefix": "@scene:%s." % sid})
	return mounts


## The save version this engine writes. Version 2 (from before the registry held the properties)
## still loads.
const SAVE_VERSION := 3


## Snapshot the whole game's NON-property state: visit counts, shared selector cursors, and every
## live flow's cursor and PRNG. The property values are the registry's: a standalone engine (one that
## made its own registry) carries them here under "registry"; a game that passed a registry saves it
## once itself (registry.save()), beside each engine's save_game().
func save_game() -> Dictionary:
	# The FAMILY's shape (patter/save@0): see PatterFlow's save-shape notes for why, and PatterSave for
	# the envelope around this.
	var flows := {}
	for id in _flows.keys():
		flows[id] = _flows[id].snapshot()
	var out := {"version": SAVE_VERSION}
	if _host["owns_registry"]:
		out["registry"] = _host["registry"].save()
	out["sharedVisits"] = _host["shared_visits"].duplicate(true)
	out["sharedSelectors"] = PatterFlow._save_selectors(_host["shared_selectors"])
	out["flows"] = flows
	return out


## Restore a save_game(): visit counts, shared selector cursors, and every flow. Property values come
## from the registry. A save that carries them (a standalone engine's, or a version 2 save from before
## the registry held them) has them moved into the registry here; otherwise the game loads its
## registry itself, before or after this call. Either order works: this engine's bags are handed back
## to the registry (values kept) and the restored flows claim them as they register.
##
## Returns false (with push_error, and nothing changed) for a save version this engine cannot read.
func load_game(save: Dictionary) -> bool:
	var version = save.get("version")
	var v := float(version) if (version is int or version is float) else -1.0
	if v != 2.0 and v != float(SAVE_VERSION):
		push_error("unsupported save version: %s" % (str(int(v)) if v == floorf(v) and v >= 0.0 else str(version)))
		return false
	if _init_error != "":
		push_error("load_game: this engine was refused its registration (%s)" % _init_error)
		return false
	var reg = _host["registry"]
	var saved_flows: Dictionary = save.get("flows", {}) if save.get("flows") is Dictionary else {}
	# Flows the save does not have are over: their bags go. The rest are handed back with their values,
	# which is what a game that loaded its registry first has just laid the save's values over.
	for id in _flows:
		_flows[id]._release_bags(saved_flows.has(id))
		_flows[id].close()
	_flows = {}
	for sid in _host["stage_bags"]:
		if reg.has(PatterFlow.key_stage(sid)):
			reg.remove(PatterFlow.key_stage(sid), {"keep": true})
	_host["stage_bags"] = {}

	var values = PatterFlow.sections_from_v2(save) if v == 2.0 else save.get("registry")
	if values is Dictionary:
		# The engine's own registry takes the save wholesale. A game's registry may hold values the
		# game loaded for other engines, still waiting to be claimed: add to those, never replace them.
		if _host["owns_registry"]:
			reg.load(values)
		else:
			reg.load(values, {"keep_parked": true})
	# Reads the family's camelCase shape and the snake_case one this addon wrote before 0.11.0.
	var visits = PatterFlow._k(save, "sharedVisits", "shared_visits")
	_host["shared_visits"] = (visits as Dictionary).duplicate(true) if visits is Dictionary else {}
	_host["shared_selectors"] = PatterFlow._load_selectors(PatterFlow._k(save, "sharedSelectors", "shared_selectors"))
	for id in saved_flows:
		var flow := PatterFlow.new(_host, float(_default_seed))
		flow.id = str(id)
		flow.restore(saved_flows[id])
		_flows[str(id)] = flow
	return true



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


# -- cast ----------------------------------------------------------------------

# Every cast member the PROJECT declares, in authored order - the same list PatterDescribe counts.
# A superset of any scene's cast: a beat's character must be a declared member, so cast_for_scene()
# and cast_for_block() only ever return names from here.
func get_cast() -> Array:
	# "cast" is absent from a bundle whose project declares none, and a nameless member is junk from a
	# hand-edited bundle: both give an empty answer, not an error.
	var names: Array = []
	for c in _host["bundle"].get("cast", []):
		var n: String = c.get("name", "")
		if n != "":
			names.append(n)
	return names


# A scene's cast: the character token of every speaker with a line anywhere in it, deduped, in
# first-appearance order. Static, like get_outline(): it walks the authored structure, so a speaker
# behind a condition, inside any group, or voicing a choice prompt counts - this is who CAN speak in
# the scene, not who a given playthrough heard. Empty for an unknown ref or a scene with no dialogue.
# Tokens, not display names: read those off a delivered step.
func cast_for_scene(scene_ref: String) -> Array:
	var cast: Array = []
	var scene_id := _resolve_scene_ref(scene_ref)
	if not _host["bundle"]["scenes"].has(scene_id):
		return cast
	var scene: Dictionary = _host["bundle"]["scenes"][scene_id]
	var seen := {}
	for block in scene["blocks"]:
		_collect_cast(block.get("children", []), seen, cast)
	return cast


# One block's cast, by scene + block ref (id or gameId). cast_for_scene(), block-scoped.
func cast_for_block(scene_ref: String, block_ref: String) -> Array:
	var cast: Array = []
	var block_id := _resolve_block_ref(_resolve_scene_ref(scene_ref), block_ref)
	if not _host["block_by_id"].has(block_id):
		return cast
	var block: Dictionary = _host["block_by_id"][block_id]
	_collect_cast(block.get("children", []), {}, cast)
	return cast


# Collect speakers under a run of nodes in document order. A group contributes its option prompt's
# speaker (a prompt is a line | text beat) before its children.
func _collect_cast(nodes: Array, seen: Dictionary, into: Array) -> void:
	for n in nodes:
		if n.get("type", "") == "group":
			var prompt: Dictionary = n.get("prompt", {})
			var pc: String = prompt.get("character", "")
			if prompt.get("kind", "") == "line" and pc != "" and not seen.has(pc):
				seen[pc] = true
				into.append(pc)
			_collect_cast(n.get("children", []), seen, into)
			continue
		for beat in n.get("beats", []):
			var c: String = beat.get("character", "")
			if beat.get("kind", "") == "line" and c != "" and not seen.has(c):
				seen[c] = true
				into.append(c)


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
