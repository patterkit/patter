# Patterplay for Unreal

Play [Patter](https://patterkit.dev/) branching dialogue natively in Unreal
Engine. Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Build Bundle* or
the `patter` CLI writes) and plays it directly in C++, with the whole API also exposed to
Blueprint. Every Patterplay runtime plays the same bundle with the same behaviour, so a story
authored once runs identically here, on the web, in Unity, and in Godot.

Full documentation: **[the Unreal guide](https://patterkit.dev/play/unreal/)**.

## Install

The release zip contains two sibling folders:

```
Patterplay/                     # this plugin - the runtime
PatterplayDemo/                 # a ready-to-open sample project (optional - delete freely)
  PatterplayDemo.uproject
```

To **try Patterplay first**, just open `PatterplayDemo.uproject` where it sits and press
**Play** - its `.uproject` finds this plugin in the sibling folder, and the demo loads its
story from disk: nothing to install, import, or place.

To **use it in your game**, copy `Patterplay/` into your project's `Plugins/` folder,
restart the editor, and enable it. Everything ships **source-only**, so a C++ project is
required; the runtime core is header-only standard C++ and compiles inside your project
with no extra dependencies.

## Import a story

A compiled `.patterc` is imported by the plugin's factory and becomes a **`UPatterBundle`**
asset in your content browser. Reference that asset wherever you build an engine.

## Play a flow

```cpp
UPatterEngine* Engine = UPatterEngine::Create(Bundle);          // Bundle: a UPatterBundle*
UPatterFlow*   Flow   = Engine->OpenFlow(TEXT("main"), TEXT("intro"));

FPatterStep Step = Flow->Advance();   // Step.Type, Step.Text, Step.Character, Step.Options
// Render Step by its kind (line / text / game event / choice / end). On a choice,
// present Step.Options (each has prompt text + an eligibility flag), then:
Flow->Choose(Step.Options[0].Id);
```

The same `UPatterEngine` / `UPatterFlow` API is exposed to **Blueprint** (with `FPatterStep`
and `FPatterOption` as Blueprint structs), so a designer can drive the flow and bind steps to
a dialogue widget without touching C++.

## Demos

The **PatterplayDemo** sample project holds two working references (see its README):

- **`APatterplayDemoActor`** - the smallest possible integration: plays a tiny shared flow
  and prints the transcript. Read this first.
- **`ATourDemoActor`** - the full interactive Patter tour in a UI overlay: a scrolling
  transcript with **clickable choices** (auto-spawned on Play by the sample's game mode),
  plus per-line audio resolution via `UPatterAudio`. Audio files are not bundled (playback
  is your platform call): point its *Audio Root* at a Patter audio folder to hear it, or
  leave it empty to play silently.

## Beyond the basics

- **Properties**: `GetProperty*` / `SetProperty*` read and write `@patter` (and wired
  external) values from C++ or Blueprint - the game pushing state into the dialogue.
- **Audio**: `UPatterAudio` reads the `patteraudio.json` manifest exported next to a Patter
  audio folder and resolves each line to its winning take - it resolves the path, you play
  it. See [the audio guide](https://patterkit.dev/play/audio/).
- **Live state**: the editor module adds **Window ▸ Tools ▸ Patterplay Runtime State**;
  register a running engine with `Engine->RegisterForDebug(...)` to watch and edit its
  `@patter` properties in Play mode.
- **Live Link**: `FPatterDebugLink` connects a running game to Patterpad, streaming the story
  cursor to the editor; `ApplyLiveBundle` hot-reloads an edited bundle into the running
  engine. See [Live refresh & debug](https://patterkit.dev/play/live-debug/).
- **Structure**: `GetOutline` / `GetBeatSequence` expose the authored tree (per-beat text,
  character, gameData, tags) for tooling like Sequencer binding.

Changes per release: [CHANGELOG.md](CHANGELOG.md).
