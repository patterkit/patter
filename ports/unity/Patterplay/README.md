# Patterplay for Unity

Play [Patter](https://patterkit.dev/) branching dialogue natively in Unity.
Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Build Bundle* or the
`patter` CLI writes) and plays it directly in C#: no web view, no JavaScript, no IPC. Every
Patterplay runtime plays the same bundle with the same behaviour, so a story authored once
runs identically here, on the web, in Unreal, and in Godot.

Full documentation: **[the Unity guide](https://patterkit.dev/play/unity/)**.

## Install

Patterplay must be installed **as a package** (its dependency on Newtonsoft Json only
resolves then). Any of:

- **Package Manager ▸ Install package from disk…** - unzip the release, pick this folder's
  `package.json`.
- **Package Manager ▸ Add package from git URL…** - paste the package git URL from the
  latest [`play-unity-v*` Release](https://github.com/patterkit/patter/releases).
- Copy this `Patterplay/` folder into your project's **`Packages/`** directory **using your
  file browser** (an "embedded package"; Unity picks it up on focus).

> Don't drag the folder into the Unity **Project window** - even dropped onto its
> *Packages* section, Unity imports it into `Assets/` as loose scripts, the `package.json`
> is ignored there, and you'll get a wall of `Newtonsoft could not be found` compile
> errors. Only the file browser or Package Manager can install a package.

The package depends on `com.unity.nuget.newtonsoft-json` (declared; Unity installs it
automatically when Patterplay is installed as a package).

## Import a story

Drop a compiled `.patterc` anywhere in your project. A ScriptedImporter converts it to a
**`PatterBundleAsset`**; reference that asset wherever you build an engine.

## Play a flow

```csharp
using Patterkit.Patterplay;

var engine = Bundle.CreateEngine();          // Bundle: a PatterBundleAsset field
var flow = engine.OpenFlow("main", "intro"); // (flow id, starting scene/block)

while (true)
{
    var step = flow.Advance();
    switch (step.Type)
    {
        case StepType.Line:   /* show step.CharacterName + step.Text */ break;
        case StepType.Text:   /* show step.Text */                      break;
        case StepType.GameEvent: /* fire step.GameData cues */          break;
        case StepType.Choice: flow.Choose(step.Options[0].Id);          break;  // your UI picks
        case StepType.End:    return;
    }
}
```

Render each step into your own dialogue UI; on a `Choice`, present `step.Options` (each has a
`Prompt` and an `Eligible` flag) and call `flow.Choose(id)` with the player's pick.

## Samples

Import from **Package Manager ▸ Patterplay ▸ Samples**. Each sample ships a **ready-made
scene** - import, open the scene, press Play, nothing to set up:

- **Tour demo** (`Tour.unity`) - the full interactive Patter tour as an OnGUI transcript
  with clickable choices, plus per-line audio resolution via `PatterAudioResolver`. Audio
  files are not bundled (playback is your platform call): point the *Audio Root* field at a
  Patter audio folder to hear it, or leave it empty to play silently.
- **Play-through demo** (`PlayThrough.unity`) - the smallest possible integration: plays a
  tiny shared flow and logs each step. Read `PatterDemo.cs` first.

## Beyond the basics

- **Save / load**: `PatterSave.SerializeState(engine)` / `DeserializeState` snapshot and
  restore the whole run as JSON.
- **Audio**: `PatterAudioResolver` reads the `patteraudio.json` manifest exported next to a
  Patter audio folder and resolves each line to its winning take - it resolves the path,
  you play it. See [the audio guide](https://patterkit.dev/play/audio/).
- **Live state**: **Window ▸ Patterplay ▸ Runtime State** shows and edits a running engine's
  `@patter` properties (register it with `PatterDebug.Register(engine)`); editor-only, never
  ships in a player build.
- **Live Link**: `PatterDebugLink` connects a running game to Patterpad, streaming the story
  cursor to the editor and hot-reloading edited bundles back in.
  See [Live refresh & debug](https://patterkit.dev/play/live-debug/).
- **Localisation**: play any locale of an Embedded bundle (`engine.SetLocale`), or ship an
  IDs-only bundle and localise in your own system.
  See [the localisation guide](https://patterkit.dev/play/localisation/).

Changes per release: [CHANGELOG.md](CHANGELOG.md).
