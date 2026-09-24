---
title: Godot
description: Play a Patter bundle in Godot with the native GDScript addon, and watch live state in an in-game inspector panel.
sidebar:
  label: Godot
---

Patterplay for Godot is the **pure-GDScript Patterplay runtime**: no web view, no native
extension to compile. It loads a `.patterc` [bundle](/format/overview/) and plays it
directly, held to the same [shared test suite](/compatibility/) as every other engine.

> Needs Godot 4.4 or newer; verified on 4.7, which every release is gated on. The runtime uses
> only plain GDScript (no scene-tree types), so it also runs headless.

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

Hand the engine your `@world` values through the **`host_scopes`** option, a `get` / `set` pair of
Callables per token, keyed by property name, that the story reads before every condition and writes
through on an effect. Bind the same store to anything else that shares those values:

```gdscript
var world := {"time_of_day": "night", "knows_road": false}
var engine := PatterEngine.new(bundle, {"host_scopes": {"world": {
    "get": func(n): return world.get(n),          # null = unset
    "set": func(n, v): world[n] = v,
}}})
```

Each binding is registered as a **foreign** scope: the values stay in your store, and no Patterplay
save holds them, so your game saves them. Leave `host_scopes` out and a standalone engine
**self-backs** `@world` from the declared defaults, as a property it stores and saves with the rest of
the run. A property declared `writable: false` in the project is the *story's* promise, so the engine
refuses the story's write with a `push_error` (`'@world.x' is read-only`) and no write, bound or
self-backed. Your own `set_property` isn't refused, because the value is the game's. A per-name policy
of your own is yours to refuse from `set`. [World Properties](/play/world-properties/) has the full
picture.

## One registry per game

Every property value lives in a **registry**, a `PatterScopeRegistry`. A game has one, and it holds
every property from every engine in the game, except values your game keeps itself behind
`host_scopes`. The registry is saved and loaded as one.

An engine you build without one makes its own and acts as its own game, which is why a single
`PatterSave.serialize_state` needs no wiring. A game that runs more than one engine (Patter beside the
Storylet Engine, say), or that wants to hold the properties itself, makes the registry and hands it to
each engine through the **`registry`** option:

```gdscript
var registry := PatterScopeRegistry.new()
registry.define_owned("world", [{"name": "gold", "type": "number", "default": 0}],
    {"owner": "Game"})                                # @world, stored and saved
var engine := PatterEngine.new(bundle, {"registry": registry})
if engine.init_error() != "":
    push_error(engine.init_error())                   # a token clash: see below

# One save for the game: the registry's values once, and each engine's part.
var json := JSON.stringify({"registry": registry.save(), "patter": PatterSave.save_state(engine)})

# Load in either order: values for bags that aren't open yet wait in the registry.
var data: Dictionary = JSON.parse_string(json)
registry.load(data["registry"])
PatterSave.load_state(engine, data["patter"])
```

Given a registry, the engine registers `@patter` under `patter` and each flow's and scene's bag under
a key starting `patter/`, which no expression can name. Its save then leaves the values out, because
your game saves the registry. `@world` is yours to register: owned, as above, when the registry should
store and save it, or bound through `host_scopes`, when your game keeps the values. The engine
self-backs nothing on a registry you pass. Every expression can read every registered scope, so a
condition can test another engine's `@story.act` once that engine is in the same registry, and
`engine.get_property("@story.act")` reads it too.

A token is taken once. Two engines that both want the same one clash as you build the second: GDScript
has no exceptions, so the registry `push_error`s a message naming who got there first, the engine's
`init_error()` returns it, the new engine is inert, and your registry is left as it was. Values a load
left for a flow that never reopened stay in the registry, and in its next save, until you call
`registry.discard_parked()`. Rebuilding an engine on an edited bundle (`hot_swap`) hands its bags to
the replacement on the same registry.

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

The protocol and the editor side are on [Live refresh & debug](/play/live-debug/).

## Save and load

`PatterSave.serialize_state(engine)` and `deserialize_state(engine, json)` round-trip the whole
run: every flow's position, visit counts, selector cursors, and the seeded random generator, as a
tagged JSON envelope. An engine you built on its own also carries every property value, `@patter`,
`@scene`, and a self-backed `@world` alike, so one call is still the whole game; an engine you gave a
registry leaves them to [the registry's save](#one-registry-per-game). `deserialize_state` returns
`false`, with a `push_error`, for a blob it cannot read. It is the **same `patter/save@0` format every
Patterplay runtime uses**, so a save written by a web build or by Patterpad loads here, and a save
written here loads in Unity or Unreal. A save written before property values moved into the registry
(version 2) still loads, and its values move into the registry as it does. Saves written by this addon
before 0.11.0 (its old snake_case shape) still load too, and are written back in the shared shape on
the next save. [Save/load & Game Data](/play/integration/) covers the format.

## Exporting your game

**Nothing to configure.** From Patterplay 0.4.5 the plugin puts your `.patterc` into the export
itself, so an exported build has its story on every platform (desktop, mobile, and web). Export as
you would any Godot project.

That is worth stating plainly because it used to be a trap. Godot packs the files it recognises as
*resources* and can silently drop everything else, so a game ran perfectly in the editor, which
reads loose project files, and shipped without its story. If you followed an older version of this
page and added `*.patterc` to your export filters, you can leave it: it is harmless, and it still
covers you if the plugin is ever disabled.

**Other loose files are still yours to handle.** The plugin knows about bundles and nothing else,
so if you use [Audio Folders](/play/audio/) add **`patteraudio.json`** under **Project ▸ Export...
▸ your preset ▸ Resources ▸ "Filters to export non-resource files/folders"**, since the audio files
themselves are imported resources and export fine, while the manifest is plain JSON and isn't. The same
goes for any other data file you read at runtime, like a `*.json` save template.

To sanity-check a build before you ship it, in the EXPORTED game rather than the editor:

```gdscript
print(FileAccess.file_exists("res://story.patterc"))   # must print true
```

## Next

- [The play loop](/play/concepts/) is the shared model.
- [Host navigation](/play/navigation/) drives the story from the game.
- [Save/load & Game Data](/play/integration/) covers Game Data, tags, host events, and localisation.
- [Compatibility & conformance](/compatibility/) explains why it matches the other engines exactly.
