@tool
# The bundle Inspector view: what Patterplay shows about a bundle.
#
# The FRAME - the widgets, the selection, the redraw, and the two states that
# are not about content (nothing selected, and a bundle that failed to load) -
# is the SHARED source, vendored beside the runtime as expr/bundle_view.gd. It
# is shared because this exact pair already drifted once: the Unreal
# equivalents diverged on the error state, and one of them stopped saying
# anything at all when a bundle had not parsed.
#
# What stays here is `_render`, which is the point of the view.
extends "res://addons/patterplay/runtime/expr/bundle_view.gd"


func _render(res: Resource) -> void:
	var selected := res as PatterBundleResource
	var d := PatterDescribe.describe_bundle(selected.get_bundle())
	var identity: Dictionary = d["identity"]
	var counts: Dictionary = d["counts"]
	var version := str(identity["version"])
	_summary.text = (
		"[b]%s[/b]  [color=gray]%s[/color]\n"
		+ "[color=gray]schema[/color] %s\n"
		+ "[color=gray]locales[/color] %s   [color=gray]strings[/color] %s\n"
		+ "[color=gray]hash[/color] %s"
	) % [
		("(unnamed project)" if str(identity["project"]) == "" else str(identity["project"])),
		version,
		str(identity["schema"]),
		str(identity["default_locale"]) + (
			"  (+%d)" % (int((identity["locales"] as Array).size()) - 1)
			if (identity["locales"] as Array).size() > 1 else ""),
		str(identity["localisation"]),
		("(none)" if str(identity["hash"]) == "" else str(identity["hash"])),
	]
	# A source-debug build embeds the source language purely so it can be played. Shipping one is a
	# mistake otherwise visible only as "strings: ids".
	if bool(identity["source_debug"]):
		_summary.text += "\n[b][color=red]SOURCE DEBUG build - not shippable[/color][/b]"

	# Addresses: what runFlow() and goto() take. The first thing an integrator opens the asset for.
	_add_section("Addresses")
	if (d["addresses"] as Array).is_empty():
		_add_row("(no scenes)", true)
	for a in d["addresses"]:
		_add_row("%s  [color=gray]%s[/color]" % [str(a["game_id"]), str(a["name"])])
		# Nested, because a block address is SCENE-SCOPED: the pair is the address, and a flat list
		# would invite calling one alone.
		for b in a["blocks"]:
			_add_row("    %s  [color=gray]%s[/color]" % [str(b["game_id"]), str(b["name"])])

	# Host properties: what the GAME must supply. The highest-value section here.
	_add_section("Host properties")
	if (d["host_scopes"] as Array).is_empty():
		_add_row("(the game supplies nothing)", true)
	for s in d["host_scopes"]:
		var head := "@%s: " % str(s["token"])
		if bool(s["opaque"]):
			head += "any name, unchecked"
		else:
			head += "%d declared" % (s["properties"] as Array).size()
		if not bool(s["writable"]):
			head += "  (read-only)"
		_add_row(head)
		for p in s["properties"]:
			_add_row("    " + _property_label(p))

	# Story-owned declarations: orientation rather than a calling surface.
	_add_section("Story properties")
	var owned: Array = d["properties"]["patter"]
	if owned.is_empty() and (d["properties"]["scene"] as Array).is_empty():
		_add_row("(none declared)", true)
	for p in owned:
		_add_row(_property_label(p))
	for sc in d["properties"]["scene"]:
		_add_row("@scene %s" % str(sc["game_id"]))
		for p in sc["properties"]:
			_add_row("    " + _property_label(p))

	# Only when there are some: an always-empty section teaches the reader to skip it.
	if not (d["game_data"] as Array).is_empty():
		_add_section("Game data")
		for g in d["game_data"]:
			_add_row("on %s" % str(g["kind"]))
			for f in g["fields"]:
				_add_row("    %s  [color=gray]%s[/color]" % [str(f["name"]), str(f["type"])])

	# "Is this the right build?" at a glance. Beats is the population get_beat_sequence walks; a
	# choice prompt hangs off its group and is counted separately rather than folded in.
	_add_section("Counts")
	_add_row("scenes %d   blocks %d   groups %d   snippets %d" % [
		int(counts["scenes"]), int(counts["blocks"]), int(counts["groups"]), int(counts["snippets"])])
	_add_row("beats %d   choice prompts %d   game events %d   cast %d" % [
		int(counts["beats"]), int(counts["prompts"]), int(counts["game_events"]), int(counts["cast"])])


## A declaration line. "no default" is the part an integrator is scanning for: it is the value the
## host must supply, or a condition reads the type default and a branch never fires.
func _property_label(p: Dictionary) -> String:
	var label := "%s  [color=gray]%s[/color]" % [str(p["name"]), str(p["type"])]
	if not bool(p["has_default"]):
		label += "  [color=gray](no default)[/color]"
	return label
