---
title: Structure introspection
description: Walk a compiled Patter bundle's authored tree (scenes, blocks, snippets, beats) without playing it, for editor and dev tooling, on any Patterplay engine. Get the nested outline or the flat, document-ordered beat sequence with per-beat data.
sidebar:
  label: Structure introspection
---

Sometimes a tool needs to see the **shape of the writing**, not play it: list the scenes, the blocks
in each, the snippets, and the beats inside them, with their ids, types, and data. Every Patterplay
engine exposes this as a **read-only, static** view of the compiled bundle: no flow, no play state.

A concrete example: in Unreal you can build a **Sequencer of subsequences**, one per beat the writer
authored, by walking the flat beat list and reading each beat's `gameData` to drive audio, camera, or
animation tracks.

## Two views: tree and flat

Both hang off the engine (build one from your bundle, then call these, no flow needed):

- **`getOutline()`** returns the **nested tree**: scenes → blocks → children (groups *and* snippets,
  groups preserved) → a snippet's beats. Use it to browse or mirror the authored structure, branches
  and all.
- **`getBeatSequence()`** returns the **flat, document-ordered** list of every beat, each with the
  `{ scene, block, snippet }` it belongs to. Use it to lay one thing per beat.

Each beat carries the same data a played step would: `id`, `kind` (line / text / gameEvent),
`character` + resolved `characterName`, `direction`, the **source `text`** (un-interpolated), the
author `gameData` overrides, and accumulated `tags`. Text and names are read at the source locale.

## Per engine

**JavaScript** (`@patterkit/runtime`):

```js
const engine = new Engine(BUNDLE);
const outline = engine.getOutline();          // OutlineScene[]
for (const flat of engine.getBeatSequence()) {
  // flat.sceneId / flat.blockId / flat.snippetId, flat.beat.{id,kind,character,text,gameData,tags}
}
```

**Unity** (C#):

```csharp
var engine = new Engine(bundle);
List<OutlineScene> outline = engine.GetOutline();
foreach (var flat in engine.GetBeatSequence())
{
    // flat.SceneId, flat.Beat.Id, flat.Beat.Kind, flat.Beat.GameData ...
}
```

**Unreal** (C++ / Blueprint):

```cpp
UPatterEngine* Engine = UPatterEngine::Create(Bundle);
TArray<FPatterOutlineScene> Outline = Engine->GetOutline();
for (const FPatterFlatBeat& Flat : Engine->GetBeatSequence())
{
    // Flat.SnippetId, Flat.Beat.Id, Flat.Beat.Kind, Flat.Beat.GameData (name/type/value) ...
}
```

Both `GetOutline` and `GetBeatSequence` are `BlueprintCallable`, so a designer can build the Sequencer
graph without C++. One Unreal-specific wrinkle: a Blueprint struct can't nest itself, so the tree is
stored **flat on each block** (`Nodes`) and linked by index (`RootIndices`, and each group node's
`ChildIndices`) rather than by nested children. `GetBeatSequence` needs none of that.

**Godot** (GDScript):

```gdscript
var engine := PatterEngine.new(bundle)
var outline := engine.get_outline()
for flat in engine.get_beat_sequence():
    # flat["sceneId"], flat["beat"]["id"], flat["beat"]["kind"], flat["beat"]["gameData"] ...
    pass
```

## Who speaks: the cast

Three more static reads answer "which characters are in this?", which is what a scene-loader, a VO
pipeline, or a character-portrait pre-loader actually wants:

- **`getCast()`** - every cast member the **project declares**, in authored order.
- **`castForScene(sceneRef)`** - the speakers with a line anywhere in that scene.
- **`castForBlock(sceneRef, blockRef)`** - the same, scoped to one block.

All three return the **character token** (the `character` a line beat carries), not a display name.
Scene and block refs may be an internal id **or** a [gameId address](/format/gamedata-and-addressing/),
so `castForScene("tavern")` works as well as `castForScene("scn_tavern")`.

```js
engine.getCast();                          // ["ANNA", "BARD", "COOK", "GUARD", "MAYOR", "SFX"]
engine.castForScene("tavern");             // ["GUARD", "ANNA", "SFX", "COOK", "BARD"]
engine.castForBlock("tavern", "greeting"); // ["GUARD", "ANNA", "SFX", "COOK"]
```

```csharp
List<string> cast = engine.CastForScene("tavern");        // Unity
```

```cpp
TArray<FString> Cast = Engine->CastForScene(TEXT("tavern")); // Unreal, BlueprintPure
```

```gdscript
var cast := engine.cast_for_scene("tavern")               # Godot
```

What counts as "in the scene" is **authored**, not played: a speaker behind a condition, inside any
group, or voicing a choice prompt is in the list, because the question is who *can* speak here. A
speaker who is only ever in a branch the player skipped is still in it. Names are deduped and ordered
by first appearance, so the list reads as the scene does. An unknown ref, or a scene of pure narration,
returns an empty list.

The caption speaker (`SFX` by default, see [closed captions](/play/closed-captions/)) is a cast member
like any other, so it appears where it has lines. Filter it out yourself if you are building a casting
sheet rather than a caption pipeline.

To turn a token into a player-facing name, read `characterName` off a delivered step: that resolves
through the active locale and follows [`setLocale`](/play/localisation/), which a static list cannot.

## Notes

- **Read-only + static.** These reflect the compiled bundle, not a running flow. `gameData` is the
  author's raw overrides (the same the step carries); merge with your defaults if you want the full set.
- **Source locale.** `text` and `characterName` come from the source language; an IDs-only bundle has
  no embedded text, so `text` is empty.
- **Order.** Within a scene, blocks / nodes / beats are in authored order. Across scenes the order is
  the bundle's scene order on most engines; the C++ (Unreal) engine iterates scenes by id. A branching
  multi-scene story has no single linear order anyway, so key off the scene id when it matters.
