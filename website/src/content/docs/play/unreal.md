---
title: Unreal
description: Play a Patter bundle in Unreal Engine with the native C++ Patterplay plugin, drop it into Plugins/, import a .patterc as an asset, drive the flow from C++ or Blueprint, and watch live state in an editor panel.
sidebar:
  label: Unreal
---

Patterplay for Unreal is the **native C++ Patterplay runtime**, wrapped in a Blueprint- and
C++-friendly plugin. It loads a `.patterc` [bundle](/format/overview/) and plays it
directly: same bundle, same behaviour, held to the same
[shared test suite](/compatibility/) as every other engine.

> Verified on Unreal Engine 5.7. Usable from C++ or Blueprint; some engineering is expected.

## Install

The release zip (from the `play-unreal-v*` Release: see the
[downloads page](/download/)) contains **two sibling folders**: the **`Patterplay/`**
runtime plugin, and **`PatterplayDemo/`**, a ready-to-open **sample project**. To try
Patterplay first, just open `PatterplayDemo.uproject` where it sits - it finds the plugin in
the sibling folder, nothing to install. To use it in your game, drop `Patterplay/` into your
project's `Plugins/` folder, restart the editor, and enable it. Everything ships
**source-only**. The runtime core is header-only standard C++, so it compiles inside your
project with no extra dependencies (a C++ project is required).

## Import a story

A compiled `.patterc` is imported by the plugin's factory and becomes a **`UPatterBundle`**
asset in your content browser. Reference that asset wherever you build an engine.

## Play a flow (C++)

The [play loop](/play/concepts/) in Unreal terms: build an engine, open a flow, advance
it, present each `FPatterStep`:

```cpp
UPatterEngine* Engine = UPatterEngine::Create(Bundle);          // Bundle: a UPatterBundle*
UPatterFlow*   Flow   = Engine->OpenFlow(TEXT("main"), TEXT("intro"));

FPatterStep Step = Flow->Advance();   // Step.Type, Step.Text, Step.Character, Step.Options
// Render Step by its kind (line / text / game event / choice / end). On a choice,
// present Step.Options (each has prompt text + an eligibility flag), then:
Flow->Choose(Step.Options[0].Id);     // your UI chooses; here, the first option
```

The same `UPatterEngine` / `UPatterFlow` API is exposed to **Blueprint**, with `FPatterStep` and
`FPatterOption` as Blueprint structs, so a designer can drive the flow and bind steps to a
dialogue widget without touching C++.

The **PatterplayDemo** sample project (the second folder in the release zip) holds two working
references. Press **Play** in it and **`ATourDemoActor`** runs the complete interactive Patter
tour in a UI overlay - a scrolling transcript with clickable choices - loading its bundle from
disk, so a fresh unzip plays with no setup. **`APatterplayDemoActor`** is the minimal shared
demo flow (the smallest render-and-choose loop, logged) to read first. The tour actor also
shows per-line audio resolution via `UPatterAudio`; audio files are not bundled (playback is
your platform call), so point its **Audio Root** at a Patter audio folder to hear it, or leave
it empty to play silently.

## Send the story somewhere

The game can also decide where the story goes. `RunFlow` plays an
[address](/format/gamedata-and-addressing/) in one call, which is all a bark needs. Both of
these are BlueprintCallable, so a designer can wire them without C++:

```cpp
// Reuses the "guard-42" flow, so its shuffles and once-each lists keep their place
TArray<FPatterStep> Lines = Engine->RunFlow(TEXT("guard-42"), TEXT("npc-barks"), TEXT("greet"));

// Or move a flow you are already driving, exactly as an authored jump would
bool bMoved = Flow->Goto(TEXT("throne-room"), TEXT("audience"));   // false = cursor unmoved
```

Give each independent speaker its own flow name. Full rules, and why `OpenFlow` behaves
differently: [Host navigation](/play/navigation/). (In the underlying std C++ core the method
is `gotoAddress`, because `goto` is a reserved word; the Blueprint-facing name is `Goto`.)

## Inspect live state

The plugin's editor module adds a **Window ▸ Tools ▸ Patterplay Runtime State** panel. Register a
running engine and it lists that engine's `@patter` properties live, with type-aware editors
(toggle / number / text / enum / flags) and a reset-to-default button, all writing straight back
into the playing game:

```cpp
UPatterEngine* Engine = UPatterEngine::Create(Bundle);
Engine->RegisterForDebug(TEXT("Main story"));   // Play mode; the panel now watches this engine
// It unregisters itself when destroyed. FPatterDebug::Register(Engine, Label) is the C++ equivalent.
```

Values refresh a few times a second without clobbering a field you're mid-edit, so you can poke a
number or flip a flag while you playtest. Every editor is also a plain Blueprint call
(`ListProperties`, `GetProperty*` / `SetProperty*`), so you can build the same watch-and-edit UI
into an in-game debug widget if you prefer. The panel lives in the plugin's **editor module**, so it
never ships in a packaged game; the debug registry it reads is compiled out of Shipping builds too.
It's the Unreal parity of Unity's Runtime State window and Godot's in-game inspector panel.

## Follow the live cursor in Patterpad

`FPatterDebugLink` streams the running story position back to Patterpad so the editor follows the
cursor like a debugger. It compiles to no-ops in a Shipping build (the WebSockets dependency is
dropped there), so it is safe to leave wired in:

```cpp
Link = FPatterDebugLink::Create(Engine->GetBuildId(), TEXT("My Game"));   // Link: TSharedPtr<FPatterDebugLink>
Link->FlowOpened(TEXT("main"));
// ...after each Advance()/Choose() (map EPatterStepType -> "line"/"text"/"gameEvent"/"choice"/"end"):
Link->Observe(TEXT("main"), Flow->CurrentScene(), Step.Id, StepTypeName(Step.Type));
```

→ [Live refresh & debug](/play/live-debug/)

## Save and load

The C++ core serialises the whole run: every flow's position, the shared `@patter` / `@scene`
state, visit counts, and the seeded random generator. Call `saveGame()` / `loadGame()` on the core
engine (reached with `UPatterEngine::Raw()`). Note the Unreal plugin does not yet ship a
Blueprint save node or a JSON `.patterstate` serialiser like the Unity and Godot runtimes, so today
save/load in Unreal is a C++ call.
→ [Save/load & Game Data](/play/integration/)

## Build against the writer's structure

`UPatterEngine::GetOutline()` and `GetBeatSequence()` expose the authored tree (scenes → blocks →
snippets → beats) as Blueprint structs, without playing. Walk the flat beat list and read each beat's
`GameData` to build, say, a **Sequencer of subsequences**, one per beat. → [Structure introspection](/play/structure/)

## Next

- The shared model: [The play loop](/play/concepts/).
- Driving the story from the game: [Host navigation](/play/navigation/).
- Reading Game Data/tags, host events, localisation: [Save/load & Game Data](/play/integration/).
- Why it matches the other engines exactly: [Compatibility & conformance](/compatibility/).
