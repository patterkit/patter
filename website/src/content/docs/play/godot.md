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

The engine serialises the whole run: every flow's position, the shared `@patter` / `@scene`
state, visit counts, and the seeded random generator: to a JSON `.patterstate` blob, so a save
round-trips through its own save format (semantically equivalent to the other engines, not
byte-identical across them).
→ [Save/load & Game Data](/play/integration/)

## Next

- The shared model: [The play loop](/play/concepts/).
- Reading Game Data/tags, host events, localisation: [Save/load & Game Data](/play/integration/).
- Why it matches the other engines exactly: [Compatibility & conformance](/compatibility/).
