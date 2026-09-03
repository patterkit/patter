---
title: Godot
description: Play a Patter bundle in Godot with the native GDScript Patterplay addon, drop it into addons/, load a .patterc, build an engine, walk the flow, and watch live state with an in-game inspector panel.
sidebar:
  label: Godot
---

Patterplay for Godot is the **pure-GDScript Patterplay runtime**: no web view, no native
extension to compile. It loads a `.patterc` [bundle](/format/overview/) and plays it
directly, held to the same [shared test suite](/compatibility/) as every other engine.

> Verified on Godot 4.7. The runtime uses only plain GDScript (no scene-tree types), so it also
> runs headless.

## Install

Drop the **`addons/patterplay/`** folder into your project's `addons/` directory (download it
from the `play-godot-v*` Release: see the [downloads page](/download/)) and enable the
plugin in *Project ▸ Project Settings ▸ Plugins*. The runtime works with or without the editor
plugin enabled; enabling it just registers the helper classes.

## Play a flow

Load the bundle text, build an engine, open a flow, and advance it. The
[play loop](/play/concepts/) in GDScript: steps come back as plain dictionaries:

```gdscript
var json   := FileAccess.get_file_as_string("res://story.patterc")
var bundle  = PatterBundle.load_from_string(json)
var engine := PatterEngine.new(bundle)
var flow   := engine.open_flow("main", "intro")     # ("flow id", starting scene/block)

while true:
    var step := flow.advance()                       # { "type": ..., "text": ..., "options": ... }
    match step["type"]:
        "line":   print("%s: %s" % [step.get("characterName", ""), step["text"]])
        "text":   print(step["text"])
        "gameEvent": pass                            # fire step.gameData cues
        "choice": flow.choose(step["options"][0]["id"])   # your UI picks
        "end":    break
```

Render each `step` into your own dialogue UI. On a `"choice"`, present `step["options"]` (each
has prompt text and an `eligible` flag) and call `flow.choose(id)` with the player's pick.

Two demos ship **inside the addon**, under `addons/patterplay/demo/` (delete the folder freely):
a headless **play-through demo** (`demo.gd`, the smallest possible integration) and the **Tour
scene** (`tour.tscn`), which plays the full interactive Patter tour with clickable choice
buttons. The tour also shows per-line audio resolution via `PatterAudio`; audio files are not
bundled (playback is your platform call), so point its **audio base** at a Patter audio folder
to hear it, or leave it unset to play silently.

## Your game's state

Hand the engine your `@world` values through the **`host_scopes`** option: a `get` / `set` pair of
Callables per token, keyed by property name, that the story reads before every condition and writes
through on an effect. Bind the same store to anything else that shares those values:

```gdscript
var world := {"time_of_day": "night", "knows_road": false}
var engine := PatterEngine.new(bundle, {"host_scopes": {"world": {
    "get": func(n): return world.get(n),          # null = unset
    "set": func(n, v): world[n] = v,
}}})
```

Leave `host_scopes` out and the engine **self-backs** `@world` from the declared defaults. A property
declared `writable: false` in the project is the *story's* promise: the engine refuses the story's
write with a `push_error` (`'@world.x' is read-only`) and no write, bound or self-backed, and a
per-name policy of your own is yours to refuse from `set`. The store is never in a Patter save: your
game saves it once. → [World Properties](/play/world-properties/)

## Send the story somewhere

The game can also decide where the story goes. `run_flow` plays an
[address](/format/gamedata-and-addressing/) in one call, which is all a bark needs:

```gdscript
# Reuses the "guard-42" flow, so its shuffles and once-each lists keep their place
var lines: Array = engine.run_flow("guard-42", "npc-barks", "greet")
for line in lines:
    print("%s: %s" % [line.get("characterName", ""), line["text"]])

# Or move a flow you are already driving, exactly as an authored jump would
var moved: bool = flow.goto("throne-room", "audience")   # false = did not resolve, cursor unmoved
```

Give each independent speaker its own flow name. Full rules, and why `open_flow` behaves
differently: [Host navigation](/play/navigation/).

## Live property inspector

A Godot game runs in its own process, so the live state inspector ships as an **in-game
overlay**, `PatterStatePanel`, it watches and edits a running engine's `@patter` properties and
saves / loads the whole run:

```gdscript
PatterDebug.register(engine)        # right after you build the engine
var panel := PatterStatePanel.new() # auto-discovers registered engines
add_child(panel)                    # (or set panel.engine = my_engine)
```

Each property gets a type-aware editor (bool / number / string / enum / flags) with a
reset-to-default button; values live-refresh without clobbering the field you're editing. The
panel is a debug tool: in a release export (`OS.is_debug_build()` false) it stays hidden and
builds nothing, so it is safe to leave in a scene that ships.

## Follow the live cursor in Patterpad

`PatterDebugLink` streams the running story position back to Patterpad so the editor follows the
cursor like a debugger. It only opens the link in a debug build, so it is inert in a release export:

```gdscript
var link := PatterDebugLink.new(engine.build_id(), "My Game")
add_child(link)
link.flow_opened("main")
# ...after each advance()/choose():
link.observe("main", flow.current_scene(), step.get("id", ""), step["type"])
```

→ [Live refresh & debug](/play/live-debug/)

## Save and load

`PatterSave.serialize_state(engine)` and `deserialize_state(engine, json)` round-trip the whole
run: every flow's position, the shared `@patter` / `@scene` state, visit counts, and the seeded random
generator, as a tagged JSON envelope. It is the **same `patter/save@0` format every Patterplay runtime
uses**, so a save written by a web build or by Patterpad loads here, and a save written here loads in
Unity or Unreal. Saves written by this addon before 0.11.0 (its old snake_case shape) still load, and
are written back in the shared shape on the next save.
→ [Save/load & Game Data](/play/integration/)

## Exporting your game

**Nothing to configure.** From Patterplay 0.4.5 the plugin puts your `.patterc` into the export
itself, so an exported build has its story on every platform - desktop, mobile and web. Export as
you would any Godot project.

That is worth stating plainly because it used to be a trap. Godot packs the files it recognises as
*resources* and can silently drop everything else, so a game ran perfectly in the editor, which
reads loose project files, and shipped without its story. If you followed an older version of this
page and added `*.patterc` to your export filters, you can leave it: it is harmless, and it still
covers you if the plugin is ever disabled.

**Other loose files are still yours to handle.** The plugin knows about bundles and nothing else,
so if you use [Audio Folders](/play/audio/) add **`patteraudio.json`** under **Project ▸ Export...
▸ your preset ▸ Resources ▸ "Filters to export non-resource files/folders"** - the audio files
themselves are imported resources and export fine, the manifest is plain JSON and is not. The same
goes for any other data file you read at runtime, like a `*.json` save template.

To sanity-check a build before you ship it, in the EXPORTED game rather than the editor:

```gdscript
print(FileAccess.file_exists("res://story.patterc"))   # must print true
```

## Next

- The shared model: [The play loop](/play/concepts/).
- Driving the story from the game: [Host navigation](/play/navigation/).
- Reading Game Data/tags, host events, localisation: [Save/load & Game Data](/play/integration/).
- Why it matches the other engines exactly: [Compatibility & conformance](/compatibility/).
