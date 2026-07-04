---
title: Unity
description: Play a Patter bundle in Unity with the native C# Patterplay runtime, import the UPM package, drop a .patterc in (a ScriptedImporter converts it), build an engine, walk the flow, and inspect live state in an editor window.
sidebar:
  label: Unity
---

Patterplay for Unity is the **native C# Patterplay runtime**: no web view, no JavaScript, no
IPC. It loads a `.patterc` [bundle](/format/overview/) and plays it directly, held to the
same [shared test suite](/compatibility/) as every other engine.

> Verified on Unity 6000.x. Some C# is expected, this is the game-developer side of the project.

## Install

Patterplay ships as a UPM package and must be installed **as a package** (its Newtonsoft
Json dependency only resolves then). Get it from the `play-unity-v*` Release (see the
[downloads page](/download/)), any of:

- **From disk**: unzip the release, then *Package Manager ▸ Install package from disk…* and
  pick the `Patterplay/` folder's `package.json`.
- **Git URL**: in *Package Manager ▸ Add package from git URL…*, paste the package's git URL
  (the Release lists it).
- **Embedded**: copy the zip's `Patterplay/` folder into your project's `Packages/`
  directory using your file browser.

Don't drag the folder into the Unity **Project window**: even dropped onto its *Packages*
section, Unity imports it into `Assets/` as loose scripts, where the package manifest is
ignored and the Newtonsoft dependency never installs (a wall of
`Newtonsoft could not be found` errors). Only the file browser or Package Manager can
install a package.

## Import a story

A compiled `.patterc` is recognised by a **ScriptedImporter**: drop the file into your project
and Unity converts it to a **`PatterBundleAsset`** (with a custom inspector). Reference that
asset wherever you build an engine.

## Play a flow

Build an engine from the bundle asset, open a flow, and advance it. The
[play loop](/play/concepts/) is the same shape as everywhere else: here it is in C#:

```csharp
using UnityEngine;
using Patterkit.Patterplay;

public sealed class StoryRunner : MonoBehaviour
{
    public PatterBundleAsset Bundle;   // the imported .patterc

    void Start()
    {
        var engine = Bundle.CreateEngine();
        PatterDebug.Register(engine);                 // optional: lets the state window watch it
        var flow = engine.OpenFlow("main", "intro");  // ("flow id", starting scene/block)

        for (;;)
        {
            var step = flow.Advance();
            switch (step.Type)
            {
                case StepType.Line: Debug.Log($"{step.CharacterName ?? step.Character}: {step.Text}"); break;
                case StepType.Text: Debug.Log(step.Text); break;
                case StepType.GameEvent: /* play step.GameData cues */ break;
                case StepType.Choice:
                    var pick = step.Options[0];        // your UI chooses; demo takes the first
                    flow.Choose(pick.Id);
                    break;
                case StepType.End:
                    Debug.Log($"[end] @gold = {engine.GetProperty("@gold")}");
                    return;
            }
        }
    }
}
```

Drop that on a GameObject, assign the imported bundle to the **Bundle** field, and press Play.
Render each `step` into your own dialogue UI; on a `Choice`, show `step.Options` (each has a
`Prompt` and an `Eligible` flag) and call `flow.Choose(id)` with the player's pick.

Two ready-made samples ship with the package - import them from **Package Manager ▸ Patterplay ▸
Samples**. Each carries a **ready-made scene**, so there is nothing to set up: import, open the
scene, press Play. The **Tour demo** (`Tour.unity`) plays the full interactive Patter tour as an
OnGUI transcript with clickable choices; the minimal **Play-through demo** (`PlayThrough.unity`)
is the smallest possible integration to read first. The tour sample also shows per-line audio
resolution via `PatterAudioResolver`; audio files are not bundled (playback is your platform
call), so point its **Audio Root** at a Patter audio folder to hear it, or leave it empty to
play silently.

## Inspect live state

The package adds **Window ▸ Patterplay ▸ Runtime State**: register a running engine with
`PatterDebug.Register(engine)` and the window shows its `@patter` properties live, with
type-aware editors (toggle / number / text / enum / flags) and a reset-to-default arrow that
write straight back into the running game. It also has **Save State… / Load State…** buttons
that persist the whole run to a `.patterstate` JSON file. The window is an editor-only tool (it
lives in an Editor assembly), so it never ships in a player build.

## Follow the live cursor in Patterpad

`PatterDebugLink` streams the running story position back to Patterpad so the editor follows the
cursor like a debugger. Wire it behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD` so it is stripped
from a release player build:

```csharp
#if UNITY_EDITOR || DEVELOPMENT_BUILD
_link = new PatterDebugLink(engine.BuildId, "My Game");
_link.FlowOpened("main");
// ...after each Advance()/Choose():
_link.Observe("main", flow.CurrentScene, step.Id, PatterDebugLink.TypeName(step.Type));
#endif
```

→ [Live refresh & debug](/play/live-debug/)

## Save and load

`PatterSave.SerializeState(engine)` and `DeserializeState(...)` round-trip the whole run: every
flow's position, the shared state, visit counts, and the PRNG, as a tagged JSON envelope
(the same shape `@patterkit/play-helpers` uses on the JS side). Persist the string wherever you
keep saves. → [Save/load & Game Data](/play/integration/)

## Next

- The shared model: [The play loop](/play/concepts/).
- Reading Game Data/tags, host events, localisation: [Save/load & Game Data](/play/integration/).
- Why it matches the other engines exactly: [Compatibility & conformance](/compatibility/).
