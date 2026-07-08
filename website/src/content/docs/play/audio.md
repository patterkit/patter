---
title: Audio
description: Patter doesn't play audio or dictate your pipeline - it gives every line a stable id you tie voice-over to, however your engine and audio tooling work. Patterpad also ships an optional Audio Folders + resolver convenience (a build-time patteraudio.json manifest that maps a beat id to its winning take) for teams who want batteries included.
sidebar:
  label: Audio
---

**Patter doesn't play audio, and it doesn't impose an audio pipeline** - your engine and your
audio tooling own that (Wwise, FMOD, engine-native, whatever you already use). What Patter gives
you is the hook every pipeline needs: **a stable [id](/format/gamedata-and-addressing/#the-two-ids)
on every line** (the same id that keys [translations](/production/localisation/)). Tie your
voice-over to that id however suits your project - an addressable, a middleware event, a filename,
a lookup table - and play it your way.

That id is all most teams need; the runtime hands it to you on every step:

```js
const step = flow.advance();
if (step.type === "line") myAudioSystem.playFor(step.id);   // your pipeline, keyed on the id
```

If you'd rather not wire up your own asset lookup, Patterpad ships an **optional** batteries-included
path on top of the id, described below. It's a convenience for teams who want it, not a requirement -
you can ignore everything past here and just key off the id.

## The built-in resolver (optional)

For teams who don't want to build their own lookup, Patterpad's **[Audio Folders](/production/audio/)**
lets you keep takes as `<beatId>.wav` (or `.mp3`) files, ranked by recording status
(scratch < recorded < final), and Patterplay resolves the **best available take** for each line
without you reimplementing that folder-ranking search.

The ranking is resolved **at build time**, not in your game. When you Build (or run **Production ▸
Update Audio Manifest**), Patterpad writes a small sidecar next to your audio, `patteraudio.json`:

```json
{ "schema": "patter/audio@0",
  "clips": {
    "L1": { "file": "final/L1.wav",   "status": "final" },
    "L2": { "file": "scratch/L2.mp3", "status": "scratch" } } }
```

Each beat maps to the **winning** file (highest recorded rung), as a path relative to your audio root.
It's a **sidecar**, never baked into the `.patterc`, so new takes don't force a story rebuild.

To ship: drop the audio folder (subfolders + `patteraudio.json`) wherever your engine reads data, then
point a resolver at it. The resolver **resolves a path; it does not play** the audio: playback is
engine-native (and can't be portable), but the part teams get stuck on, finding the right file, is done
for you.

## Wire it into your game

Each engine has the same tiny resolver: build it from the manifest + the base path where you deployed
the audio, then `resolve(beatId)` returns the full path/URL (or nothing when a line has no recording).

**JavaScript** (`@patterkit/play-helpers`):

```js
import { createAudioResolver } from "@patterkit/play-helpers";

const manifest = await (await fetch("audio/patteraudio.json")).text();
const audio = createAudioResolver(manifest, "audio");     // base = where you served the folder

const step = flow.advance();
const src = audio.resolve(step.id);                        // "audio/final/L1.wav", or null
if (src) new Audio(src).play();                            // playback is yours
```

**Unity** (C#), deploy the folder under `StreamingAssets`:

```csharp
var json = File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "audio", "patteraudio.json"));
var audio = new PatterAudioResolver(json, Path.Combine(Application.streamingAssetsPath, "audio"));
string path = audio.Resolve(step.Id);                      // full path, or null
```

**Unreal** (C++ / Blueprint): `UPatterAudio` is BlueprintCallable, so this can be graph-only:

```cpp
UPatterAudio* Audio = UPatterAudio::Load(ManifestJson, TEXT("Audio"));
FString Path = Audio->Resolve(Step.Id);                    // full path, or empty
```

**Godot** (GDScript), deploy under `res://` (or `user://`):

```gdscript
var json := FileAccess.get_file_as_string("res://audio/patteraudio.json")
var audio := PatterAudio.new(json, "res://audio")
var path := audio.resolve(step.get("id", ""))              # full path, or "" when none
if path != "": my_player.stream = load(path)
```

## Notes

- **Resolve, not play.** Every engine returns a path/URL; you load and play it your way. That boundary
  is deliberate, audio playback isn't portable, but resolution is.
- **No search shipped.** The winner is chosen at build time, so the runtime just does a map lookup.
- **No recording?** `resolve` returns null / empty for a beat with no take, so you can fall back to
  on-screen text or silence.
- **Single language** for now (VO isn't localised per-locale yet).
- **Keep it fresh.** Re-run **Update Audio Manifest** (or Build) after adding takes so `patteraudio.json`
  reflects the latest winners.
