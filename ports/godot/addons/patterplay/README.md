# Patterplay for Godot

Play [Patter](https://patterkit.dev/) branching dialogue natively in Godot.
Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Build Bundle* or the
`patter` CLI writes) and plays it in pure GDScript: no web view, no native extension to
compile. Every Patterplay runtime plays the same bundle with the same behaviour, so a story
authored once runs identically here, on the web, in Unity, and in Unreal.

Full documentation: **[the Godot guide](https://patterkit.dev/play/godot/)**.

## Install

Drop this `patterplay/` folder into your project's `addons/` directory and enable the plugin
in *Project ▸ Project Settings ▸ Plugins*. The runtime works with or without the editor plugin
enabled; enabling it just registers the helper classes. Requires Godot 4.x (the tour demo's
optional audio playback needs 4.4+).

## Play a flow

```gdscript
var json   := FileAccess.get_file_as_string("res://story.patterc")
var bundle  = PatterBundle.load_from_string(json)
var engine := PatterEngine.new(bundle)
var flow   := engine.open_flow("main", "intro")     # ("flow id", starting scene/block)

while true:
    var step := flow.advance()                       # { "type": ..., "text": ..., "options": ... }
    match step["type"]:
        "line":      print("%s: %s" % [step.get("characterName", ""), step["text"]])
        "text":      print(step["text"])
        "gameEvent": pass                            # fire step.gameData cues
        "choice":    flow.choose(step["options"][0]["id"])   # your UI picks
        "end":       break
```

Render each step into your own dialogue UI; on a `"choice"`, present `step["options"]` (each
has prompt text and an `eligible` flag) and call `flow.choose(id)` with the player's pick.

## Demos

In `demo/` (delete the folder freely):

- **`demo.gd`** - the smallest possible integration: plays a tiny shared flow headless and
  prints each step. Read this first.
  Run it: `godot --headless --path <project> --script res://addons/patterplay/demo/demo.gd`
- **`tour.tscn`** - the full interactive Patter tour with clickable choice buttons, plus
  per-line audio resolution via `PatterAudio`. Audio files are not bundled (playback is your
  platform call): point its audio base at a Patter audio folder to hear it, or leave it unset
  to play silently.

## Beyond the basics

- **Save / load**: `engine.save_game()` / `engine.load_game(blob)` snapshot and restore the
  whole run as a JSON-ready dictionary.
- **Audio**: `PatterAudio` reads the `patteraudio.json` manifest exported next to a Patter
  audio folder and resolves each line to its winning take - it resolves the path, you play
  it. See [the audio guide](https://patterkit.dev/play/audio/).
- **Live state**: add a `PatterStatePanel` (an in-game overlay) and register your engine with
  `PatterDebug.register(engine)` to watch and edit its `@patter` properties while playing.
- **Live Link**: `PatterDebugLink` connects a running game to Patterpad, streaming the story
  cursor to the editor and hot-reloading edited bundles back in.
  See [Live refresh & debug](https://patterkit.dev/play/live-debug/).
- **Localisation**: play any locale of an Embedded bundle (`engine.set_locale`), or ship an
  IDs-only bundle and localise in your own system.
  See [the localisation guide](https://patterkit.dev/play/localisation/).

Changes per release: [CHANGELOG.md](CHANGELOG.md).
