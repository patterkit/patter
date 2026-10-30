# Patterplay for Godot

Play [Patter](https://patterkit.dev/) branching dialogue natively in Godot.
Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Publish Bundle* or the
`patter` CLI writes) and plays it in pure GDScript: no web view, no native extension to
compile. Every Patterplay runtime plays the same bundle with the same behaviour, so a story
authored once runs identically here, on the web, in Unity, and in Unreal.

Full documentation: **[the Godot guide](https://patterkit.dev/play/godot/)**.

## Install

Drop this `patterplay/` folder into your project's `addons/` directory and enable the plugin
in *Project ▸ Project Settings ▸ Plugins*. The runtime works with or without the editor plugin
enabled; enabling it just registers the helper classes. Requires **Godot 4.4 or newer**, and is
verified on 4.7, which every release is gated on.

## Play a flow

```gdscript
var json   := FileAccess.get_file_as_string("res://story.patterc")
var bundle  = PatterBundle.load_from_string(json)
var engine := PatterEngine.new(bundle)
var flow   := engine.open_flow("main", "intro")     # ("flow id", starting scene/block)

while true:
    var step := flow.advance()                       # { "type": ..., "text": ..., "options": ... }
    match step["type"]:
        "line":      print("%s: %s" % [step.get("speakerLabel", ""), step["text"]])
        "text":      print(step["text"])
        "gameEvent": pass                            # fire step.gameData cues
        "choice":    flow.choose(step["options"][0]["id"])   # your UI picks
        "end":       break
```

Render each step into your own dialogue UI; on a `"choice"`, present `step["options"]` (each
has a `prompt` whose `"text"` is the label, and an `eligible` flag) and call `flow.choose(id)`
with the player's pick.

A `"line"` step names its speaker with `character` (the cast token) and `characterName` (the shown
name), and carries `direction` when set. A line with a speaker qualifier (`TAM (O.S.)`) also carries
`qualifier`, the qualifier's `gameId` (`"os"`) for your game to switch on, and `qualifierName`, its
shown name (`"O.S."`) in the active language. A line prompt on a choice option carries the same fields.

To show who's speaking, use `speakerLabel`, the speaker's label in the active language, rather than putting
the name and the qualifier together yourself: word order and punctuation differ by language, and a writer
can give a pair its own label. With a qualifier it's that character's own label for the pair when the
project gives one (`"Your thoughts"`), else the project's speaker pattern filled in (`"You (V.O.)"` by
default); with none, it's the shown name (the `character` token when the cast gives no name). It's absent
when the line has no speaker, when closed captions silence it, and in an IDs-only build. A replayed prompt
and a saved choice keep it, and `get_outline()` and `get_beat_sequence()` give it in the source language.

Every `"line"` and `"text"` step also carries `padAfter`, the pause after it in seconds, before the next
line: positive waits, zero follows at once, and negative starts the next line that long before this one
ends (a cut-in). It is already resolved: the beat's own value, else the nearest default above it
(snippet, group, block, scene, then the project's), else 0.6. Only a snippet's last line is never
negative; a negative pause before a game event stands. A replayed prompt carries its option's pause, and
so does each choice option's `prompt`, as `padAfter`, for a game that voices the prompts itself. A line
silenced by closed captions keeps its pause.
When your game times lines itself, follow the [timing rules](https://patterkit.dev/play/engine/#step-shapes) the writer expects. `get_outline()` and `get_beat_sequence()`
give each line and text beat its resolved `padAfter`, and `ownPadAfter` when the beat sets its own. For a
line with no recording, `PatterBundle.estimate_line_duration(text)` gives how long it lasts, in seconds: Patter's
one rule, the same in every runtime and in Patterpad's Play window.

A `"text"` step with `action: true` is action: a direction for whoever stages the scene, never shown to the
player. It's a dialogue scene's text when the project doesn't localise it, and its text is the source in
every locale. The key is absent on shown text, and a replayed prompt is never action.

To show a line again that your game kept by id (after a load, or a language switch), call
`flow.step_for(beat_id)`. It gives the step `advance()` would give for that beat right now, built the same
way: the text in the active locale, interpolated against the flow's values, closed captions applied, and the
names, label, pause, Game Data, extension values, and tags. It doesn't move the flow, count a visit, or run an effect, and it
returns `null` for an id that isn't a beat or an option's prompt.

## Demos

In `demo/` (delete the folder freely):

- **`demo.gd`** - the smallest possible integration: plays a tiny shared flow headless and
  prints each step. Read this first.
  Run it: `godot --headless --path <project> --script res://addons/patterplay/demo/demo.gd`
- **`tour.tscn`** - the full interactive Patter tour with clickable choice buttons, plus
  per-line audio resolution via `PatterAudioResolver`. Audio files are not bundled (playback is your
  platform call): point its audio base at a Patter audio folder to hear it, or leave it unset
  to play silently.

## Beyond the basics

- **Save / load**: `PatterSave.serialize_state(engine)` / `deserialize_state(engine, json)` (or
  `engine.save_game()` / `engine.load_game(blob)` for the bare dictionary) snapshot and restore the
  whole run. Saves are the shared `patter/save@0` format, version 4; a version 3 save still loads. A
  pending choice saves which options were offered, not their text, so a load shows it in the language in
  use. A load whose place has gone from an edited build resumes at the nearest safe point and reports it
  through `on_error` (kind `"save"`).
- **One flow as data**: `engine.capture_flow(id)` returns a flow's state as a plain Dictionary (its
  cursor, PRNG, visits, and selectors, as a save writes them, plus its own `@patter` and `@scene`
  values), without its id, for your game to keep and save like anything else. `engine.restore_flow(id,
  state)` opens a flow from it, under that id or another, and carries on where it was; shared state
  isn't in it, so nothing else is rewound. Capture before `close_flow`, which drops the flow's values.
  Capturing is allowed inside a checkpoint; restoring isn't, nor over an id that is open (it returns
  null, with `push_error`).
- **Game Data**: a step, an option, and each scene and block carry the writer's `gameData` overrides
  raw (`engine.game_data_for_scene(ref)` and `engine.game_data_for_block(scene, block)` for a scene's and a
  block's own). `PatterBundle.effective_game_data(PatterBundle.game_data_fields(bundle, kind), node)` fills
  in the declared defaults.
- **Patter extension values**: when the project uses Patter extensions, a `"line"`, `"text"` or
  `"gameEvent"` step, a choice option, and each scene, block and beat of `get_outline()` carry
  `extensions`, by extension id, raw as the bundle wrote them (any JSON), and only when the node has any.
  `engine.extensions_for_scene(ref)`, `engine.extensions_for_block(scene, block)` and
  `engine.extensions_for_snippet(snippet_id)` read a scene's, a block's and a snippet's own. Fill in an extension's defaults with the same helper, given its declarations:
  `PatterBundle.effective_game_data(PatterBundle.extension_decls(bundle, id, kind), step["extensions"].get(id))`.
  `PatterBundle.extensions_of(bundle, kind, address)` reads any node's values off the bundle: `"project"`
  (no address), `"scene"`, `"block"` (`"scene/block"`), or a `"snippet"`, `"option"`, `"line"`, `"text"` or
  `"gameEvent"` by id.
- **Your game's state and one registry per game**: bind `@world` to your own store with the
  `host_scopes` option, or hand the engine your game's `PatterScopeRegistry` with the `registry`
  option so every engine in the game shares one set of properties and one save. Without a registry
  the engine makes its own, and its save carries every property value. See
  [One registry per game](https://patterkit.dev/play/godot/#one-registry-per-game).
- **Audio**: `PatterAudioResolver` reads the `patteraudio.json` manifest exported next to a Patter
  audio folder and resolves each line to its winning take - it resolves the path, you play
  it. See [the audio guide](https://patterkit.dev/play/audio/).
- **Live state**: add a `PatterStatePanel` (an in-game overlay) and register your engine with
  `PatterDebug.register(engine)` to watch and edit its `@patter` properties while playing.
- **Live Link**: `PatterDebugLink` connects a running game to Patterpad, streaming the story
  cursor to the editor and hot-reloading edited bundles back in.
  See [Live refresh & debug](https://patterkit.dev/play/live-debug/).
- **Localisation**: play any locale of an Embedded bundle (the `locale` option or `engine.set_locale`), or
  ship an IDs-only bundle and localise in your own system. A locale resolves by one rule: case and `_` /
  `-` don't matter, then the language alone (`fr` for `fr-FR`), then the default, and anything but an
  exact match is reported. `engine.locale()` is the locale in use; `engine.locales()` gives the bundle's
  `{"default", "included"}`.
- **Problems and refusals**: the engine reports what it carried on past to your `on_error` Callable (or
  `push_warning`): a content error, how it was set up (`"setup"`: an option key it doesn't take, a locale
  the bundle doesn't have, a host scope it doesn't declare, reported as the engine is built), a load
  whose place has gone (`"save"`), and a choice that ran dry and so ended the flow (`"dry-choice"`, whose
  `node` is the choice group: a hub whose options were all used, say). That flow's `"end"` step says
  `"reason": "ran-dry"`; any other end says `"ended"`. The reason survives a save and load, and the host's
  `goto("END")` is a plain end. A dry choice that play carries on past isn't reported: it's the gather
  idiom. A call it refuses can't throw in GDScript: `set_property` returns the
  refusal (`""` when written; a value that doesn't fit its declaration, or a name the content doesn't
  declare, is refused), and `advance()` and `choose()` keep theirs for `flow.last_error()`, cleared by the
  next success. Each is also `push_error`'d.
- **Copies and read-only values**: the Game Data and tags a step, an option, an outline, or a lookup hands
  you are your own copies, so editing them changes nothing the engine says next. Extension values are the
  bundle's own: read them, never edit them.
- **Exporting**: nothing to configure. From 0.4.5 the plugin puts your bundle into the export
  itself, so a build has its story on every platform. (If you use Audio Folders, `patteraudio.json`
  is still yours to add to the export filters.) Details:
  [Exporting your game](https://patterkit.dev/play/godot/#exporting-your-game).
  See [the localisation guide](https://patterkit.dev/play/localisation/).

Changes per release: [CHANGELOG.md](CHANGELOG.md).
