# The bundle inspector's runtime half: describe a compiled bundle without running it. Port of the JS
# reference (packages/runtime/src/describe.ts); read that header for the argument, not repeated here.
#
# A BUNDLE-level function, deliberately NOT an engine method. It answers the integrator's question
# from the imported asset alone, with no engine, no state and nothing running:
#
#     I dropped a .patterc into my project. What may my game code call, and is this the bundle I
#     think it is?
#
# That is a different question from the one the state panel answers: the examiner watches and edits a
# LIVE game, this is static, read off the asset before anything runs.
#
# Everything is in BUNDLE ORDER, never sorted: two runtimes must render the same rows in the same
# sequence, and bundle order is the only order all four ports agree on without a collation rule.
# Cheap by construction: one walk, no expression parsing, no string tables.
class_name PatterDescribe


# Describe a compiled bundle Dictionary (as returned by PatterBundle.load_from_string).
#
# Returns a Dictionary shaped like the JS BundleDescription:
#   identity   { schema, project, version, hash, structure_hash, voiced, default_locale, locales,
#                localisation, source_debug }
#   addresses  [ { game_id, name, blocks: [ { game_id, name } ] } ]
#   host_scopes[ { token, writable, opaque, properties: [property] } ]
#   properties { patter: [property], scene: [ { game_id, properties: [property] } ] }
#   game_data  [ { kind, fields: [ { name, type, has_default, values } ] } ]
#   counts     { scenes, blocks, groups, snippets, beats, prompts, game_events, cast }
# where a property is { name, type, has_default, default, shared }.
static func describe_bundle(bundle: Dictionary) -> Dictionary:
	var counts := {
		"scenes": 0, "blocks": 0, "groups": 0, "snippets": 0,
		"beats": 0, "prompts": 0, "game_events": 0,
		"cast": bundle.get("cast", []).size(),
	}
	var addresses: Array = []
	var scene_props: Array = []

	for sid in bundle.get("scenes", {}).keys():
		var scene: Dictionary = bundle["scenes"][sid]
		counts["scenes"] += 1
		var game_id := PatterBundle.effective_game_id(scene)
		var blocks: Array = []
		for block in scene.get("blocks", []):
			blocks.append({ "game_id": PatterBundle.effective_game_id(block), "name": block.get("name", "") })
		addresses.append({ "game_id": game_id, "name": scene.get("name", ""), "blocks": blocks })
		for block in scene.get("blocks", []):
			_count_block(block, counts)
		# Scene-local declarations default to PER-FLOW, unlike project-level ones.
		var props: Array = scene.get("sceneProps", [])
		if props.size() > 0:
			var rows: Array = []
			for d in props:
				rows.append(_summarise_property(d, false))
			scene_props.append({ "game_id": game_id, "properties": rows })

	var host_scopes: Array = []
	for spec in bundle.get("scopeRegistry", {}).get("scopes", []):
		var rows: Array = []
		for d in spec.get("declarations", []):
			rows.append(_summarise_host_property(d))
		host_scopes.append({
			"token": spec.get("token", ""),
			"writable": spec.get("writable", true),
			# An OPAQUE scope declares no names: any name is accepted, unchecked. The host contract is
			# then "anything", which is worth showing as such rather than as an empty property list.
			"opaque": not spec.has("declarations"),
			"properties": rows,
		})

	var patter_props: Array = []
	for d in bundle.get("properties", []):
		patter_props.append(_summarise_property(d, true))

	var game_data: Array = []
	for kind in bundle.get("gameDataFields", {}).keys():
		var fields: Array = bundle["gameDataFields"][kind]
		if fields.size() == 0:
			continue
		var rows: Array = []
		for f in fields:
			rows.append({
				"name": f.get("name", ""),
				"type": f.get("type", ""),
				"has_default": f.has("default"),
				"values": f.get("values", []),
			})
		game_data.append({ "kind": kind, "fields": rows })

	var loc: Dictionary = bundle.get("localisation", {})
	var content: Dictionary = bundle.get("content", {})
	return {
		"identity": {
			"schema": bundle.get("schema", ""),
			"project": content.get("project", ""),
			"version": content.get("version", ""),
			"hash": content.get("hash", ""),
			# The same fingerprint with the string tables left out. Equal structure_hash plus a
			# different hash means a TEXT-ONLY edit, which is what makes a live hot-swap safe.
			"structure_hash": content.get("structureHash", ""),
			"voiced": bundle.get("voiced", false),
			"default_locale": bundle.get("locales", {}).get("default", ""),
			"locales": bundle.get("locales", {}).get("included", []),
			# Absent means "embedded": the back-compat default a bundle written before the field
			# existed relies on.
			"localisation": loc.get("mode", "embedded"),
			# True when the source locale was embedded purely for debug playback. Such a build is NOT
			# shippable, which is worth saying loudly in an inspector.
			"source_debug": loc.get("sourceDebug", false),
		},
		"addresses": addresses,
		"host_scopes": host_scopes,
		"properties": { "patter": patter_props, "scene": scene_props },
		"game_data": game_data,
		"counts": counts,
	}


# A declaration's sharing default differs by the scope it sits in: a project-level property is
# shared, a scene-local one is per-flow.
static func _summarise_property(decl: Dictionary, scope_default: bool) -> Dictionary:
	return {
		"name": decl.get("name", ""),
		"type": decl.get("type", ""),
		"has_default": decl.has("default"),
		"default": PatterValues.to_value(decl["default"]) if decl.has("default") else null,
		"shared": decl.get("shared", scope_default),
	}


# A host scope's values live outside the story, so "shared" is not a choice its declarations make:
# they are world-wide by nature.
static func _summarise_host_property(decl: Dictionary) -> Dictionary:
	var row := _summarise_property(decl, true)
	row["shared"] = true
	return row


# One pass over a block's tree. Iterative rather than recursive: a deeply nested choice tree should
# not put an inspector's stack at risk, and traversal order does not matter to a count.
static func _count_block(block: Dictionary, counts: Dictionary) -> void:
	counts["blocks"] += 1
	var stack: Array = []
	for child in block.get("children", []):
		stack.append(child)
	while stack.size() > 0:
		var node: Dictionary = stack.pop_back()
		if node.get("type", "") == "group":
			counts["groups"] += 1
			if node.has("prompt"):
				counts["prompts"] += 1
			for child in node.get("children", []):
				stack.append(child)
			continue
		counts["snippets"] += 1
		for beat in node.get("beats", []):
			counts["beats"] += 1
			if beat.get("kind", "") == "gameEvent":
				counts["game_events"] += 1
