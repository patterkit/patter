# A line's speaker label (`speakerLabel`), headless: the one resolver the line step, the line prompt, a
# saved prompt, and the static structure share. The corpus pins the label everywhere every runtime shows
# it; this covers what the corpus can't reach so directly:
#   1. a pair the bundle doesn't override ignores a `speaker:` string a locale still holds for it (a stale
#      one, left behind when a writer cleared their own label), and follows the pattern
#   2. a pair the bundle does override reads its `speaker:` string, then its authored label
#   3. a saved choice prompt from before prompts carried the label is resolved again on load, from the
#      saved character and qualifier, in the locale the loading engine is in, and so is a saved prompt
#      still to be spoken back (taken between choose and advance)
#   4. the beat sequence gives the label in the source locale, whatever the engine's locale is
#   5. no label with no speaker or in IDs-only mode, and the placeholders are plain text replacement
#
#   godot --headless --path ports/godot --script res://test/test_speaker_label.gd
extends SceneTree

var _fails := 0


func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en", "fr"]},
		"cast": [
			{"name": "PLAYER", "displayName": "You", "qualifierLabels": {"vo": "Your thoughts"}},
			{"name": "GUARD", "displayName": "Guard"},
		],
		"qualifiers": [{"gameId": "vo", "name": "V.O."}],
		"strings": {
			"en": {"L_g": "Halt.", "L_p": "Hmm.", "L_n": "Wind.", "P": "Ask"},
			"fr": {"L_g": "Halte.", "L_p": "Hum.", "L_n": "Vent.", "P": "Demander",
				"cast:PLAYER": "Vous", "cast:GUARD": "Garde", "qualifier:vo": "V.F.",
				"speaker:pattern": "{qualifier} : {name}",
				"speaker:PLAYER:vo": "Tes pensées",
				# Stale: GUARD has no label of its own with V.O., so this is never read.
				"speaker:GUARD:vo": "Pensées du garde"},
		},
		"scenes": {"s": {"id": "s", "gameId": "s", "blocks": [{"id": "b", "gameId": "b", "children": [
			{"id": "sn", "type": "snippet", "beats": [
				{"id": "L_g", "kind": "line", "character": "GUARD", "qualifier": "vo"},
				{"id": "L_p", "kind": "line", "character": "PLAYER", "qualifier": "vo"},
				{"id": "L_n", "kind": "line"},
			]},
			{"id": "g", "type": "group", "selector": "choice", "children": [
				{"id": "o", "type": "group", "prompt": {"id": "P", "kind": "line", "character": "PLAYER", "qualifier": "vo"}, "children": [
					{"id": "sn_o", "type": "snippet", "beats": [{"id": "L_n", "kind": "line"}], "jump": {"to": "END"}}]},
			]},
		]}]}},
	}


func _initialize() -> void:
	_check_lines("en", "Guard (V.O.)", "Your thoughts")
	_check_lines("fr", "V.F. : Garde", "Tes pensées")
	_check_older_save()
	_check_older_replay_save()
	_check_source_locale()
	_check_none()
	_check_format()
	print("test_speaker_label: ALL PASS" if _fails == 0 else "test_speaker_label: %d FAILED" % _fails)
	quit(1 if _fails > 0 else 0)


# 1 and 2: the pattern for a pair nobody overrode (a stale `speaker:` string ignored), the pair's own label
# for one somebody did, and no label on a line with no speaker. The choice prompt carries the label too.
func _check_lines(locale: String, guard: String, player: String) -> void:
	var flow := PatterEngine.new(_bundle(), {"locale": locale}).open_flow("main", "s")
	var g: Dictionary = flow.advance()
	_expect(g.get("speakerLabel") == guard, "%s: a pair nobody overrode follows the pattern: %s" % [locale, g])
	var p: Dictionary = flow.advance()
	_expect(p.get("speakerLabel") == player, "%s: an overridden pair shows its own label: %s" % [locale, p])
	var n: Dictionary = flow.advance()
	_expect(not n.has("speakerLabel"), "%s: a line with no speaker has no label: %s" % [locale, n])
	var c: Dictionary = flow.advance()
	var prompt: Dictionary = c["options"][0]["prompt"]
	_expect(prompt.get("speakerLabel") == player, "%s: a line prompt carries the label: %s" % [locale, prompt])


# 3: a save taken at the choice, with the label taken out of the pending prompt as an older save has it,
# loaded into an engine in French: the label comes back, resolved in French, and the rest is as saved.
func _check_older_save() -> void:
	var engine := PatterEngine.new(_bundle(), {})
	var flow := engine.open_flow("main", "s")
	for i in 4:
		flow.advance()
	var save: Dictionary = JSON.parse_string(JSON.stringify(engine.save_game()))
	var prompt: Dictionary = save["flows"]["main"]["cursor"]["pendingChoice"]["options"][0]["prompt"]
	_expect(prompt.get("speakerLabel") == "Your thoughts", "a save carries the prompt's label: %s" % prompt)
	prompt.erase("speakerLabel")
	var later := PatterEngine.new(_bundle(), {"locale": "fr"})
	later.load_game(save)
	var loaded: Dictionary = later.get_flow("main").get_choices()[0]["prompt"]
	_expect(loaded.get("speakerLabel") == "Tes pensées", "an older save's prompt gets its label again, in the current locale: %s" % loaded)
	_expect(loaded.get("characterName") == "You", "the rest of the saved prompt is as the choice showed it: %s" % loaded)


# 3: a save taken between choose and advance, with replay_prompt_on_choose, carries the prompt still to be
# spoken back. With the label taken out of it, as an older save has it, and loaded into an engine in
# French, the replayed prompt comes back labelled in French.
func _check_older_replay_save() -> void:
	var engine := PatterEngine.new(_bundle(), {"replay_prompt_on_choose": true})
	var flow := engine.open_flow("main", "s")
	for i in 4:
		flow.advance()
	flow.choose("o")
	var save: Dictionary = JSON.parse_string(JSON.stringify(engine.save_game()))
	var pending = save["flows"]["main"]["cursor"].get("pendingPrompt")
	_expect(pending is Dictionary and pending.get("speakerLabel") == "Your thoughts", "a save carries the prompt still to be spoken back, with its label: %s" % [pending])
	if not (pending is Dictionary):
		return
	pending.erase("speakerLabel")
	var later := PatterEngine.new(_bundle(), {"locale": "fr", "replay_prompt_on_choose": true})
	later.load_game(save)
	var replayed: Dictionary = later.get_flow("main").advance()
	_expect(replayed.get("id") == "P" and replayed.get("speakerLabel") == "Tes pensées", "an older save's prompt still to be spoken back gets its label again, in the current locale: %s" % replayed)
	_expect(replayed.get("characterName") == "You", "the rest of the replayed prompt is as the choice showed it: %s" % replayed)


# 4: the static structure reads the source locale only.
func _check_source_locale() -> void:
	var labels: Array = []
	for e in PatterEngine.new(_bundle(), {"locale": "fr"}).get_beat_sequence():
		labels.append(e["beat"].get("speakerLabel"))
	_expect(labels == ["Guard (V.O.)", "Your thoughts", null, null], "the beat sequence labels are the source locale's: %s" % [labels])


# 5: IDs-only mode leaves names to the game, the label among them; a source-debug build still resolves it.
func _check_none() -> void:
	var ids := _bundle()
	ids["localisation"] = {"mode": "ids"}
	var step: Dictionary = PatterEngine.new(ids, {}).open_flow("main", "s").advance()
	_expect(not step.has("speakerLabel"), "IDs-only mode gives no label: %s" % step)
	ids["localisation"] = {"mode": "ids", "sourceDebug": true}
	step = PatterEngine.new(ids, {}).open_flow("main", "s").advance()
	_expect(step.get("speakerLabel") == "Guard (V.O.)", "a source-debug build gives the label: %s" % step)


# 5: every placeholder is replaced, and a filled-in name is never read again; the bundle's own pattern is
# the fallback when no locale holds `speaker:pattern`.
func _check_format() -> void:
	var s := PatterBundle.format_speaker_label("{name}/{name}: {qualifier}{qualifier}", "A{qualifier}", "Q")
	_expect(s == "A{qualifier}/A{qualifier}: QQ", "the placeholders are plain text replacement: " + s)
	var b := _bundle()
	b["speakerPattern"] = "{name}, {qualifier}"
	var step: Dictionary = PatterEngine.new(b, {}).open_flow("main", "s").advance()
	_expect(step.get("speakerLabel") == "Guard, V.O.", "the bundle's pattern fills an unoverridden pair: %s" % step)


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		push_error("FAIL: " + what)
