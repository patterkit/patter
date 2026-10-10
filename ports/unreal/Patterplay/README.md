# Patterplay for Unreal

Play [Patter](https://patterkit.dev/) branching dialogue natively in Unreal
Engine. Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Build Bundle* or
the `patter` CLI writes) and plays it directly in C++, with the whole API also exposed to
Blueprint. Every Patterplay runtime plays the same bundle with the same behaviour, so a story
authored once runs identically here, on the web, in Unity, and in Godot.

Works with Unreal Engine 5.7 and 5.8 (verified on 5.7.4 and 5.8.3). Full documentation:
**[the Unreal guide](https://patterkit.dev/play/unreal/)**.

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

A line step names its speaker (`Character`, and `CharacterName`, the locale-resolved name), its
`Direction`, and any speaker qualifier: `Qualifier` is the qualifier's gameId (`vo`, `os`, `radio`) for
your code to switch on, and `QualifierName` its shown name (`O.S.`), so a dialogue widget can show
`TAM (O.S.)`. An option's `Prompt` carries the same fields, and each has a `bHas` flag for whether it is set.

A line or text step also carries `PadAfter`, the pause after it in seconds, before the next line: the
line's own, else the nearest default above it (its snippet, groups, block, scene, then the project's),
else the built-in 0.6. A negative value starts the next line that long before this one ends (a cut-in);
only a snippet's last line is never negative (a negative pause before a game event stands). An option's
`Prompt` carries its pause too, as `PadAfter`, for a game that voices the prompts itself. When your game times lines itself, follow the [timing rules](https://patterkit.dev/play/engine/#step-shapes) the writer expects.

The same `UPatterEngine` / `UPatterFlow` API is exposed to **Blueprint** (with `FPatterStep`
and `FPatterOption` as Blueprint structs), so a designer can drive the flow and bind steps to
a dialogue widget without touching C++.

## Demos

The **PatterplayDemo** sample project holds two working references (see its README):

- **`APatterplayDemoActor`** - the smallest possible integration: plays a tiny shared flow
  and prints the transcript. Read this first.
- **`ATourDemoActor`** - the full interactive Patter tour in a UI overlay: a scrolling
  transcript with **clickable choices** (auto-spawned on Play by the sample's game mode),
  plus per-line audio resolution via `UPatterAudioResolver`. Audio files are not bundled (playback
  is your platform call): point its *Audio Root* at a Patter audio folder to hear it, or
  leave it empty to play silently.

## Beyond the basics

- **Properties**: `GetProperty*` / `SetProperty*` read and write `@patter` (and wired
  external) values from C++ or Blueprint - the game pushing state into the dialogue. Bind your
  own `@world` container with `UPatterEngine::Create(Bundle, World)`.
- **Save and load**: `UPatterSave::SerializeState` / `DeserializeState` write and read the
  whole run as one JSON string (save version 3; a version 2 save inside the same envelope still loads).
- **One registry per game** (C++): every property lives in a `patter::ScopeRegistry`. An engine
  makes its own by default; `UPatterEngine::CreateWithRegistry` builds one on your game's registry,
  which your game then saves once with `patter::saveRegistry`. The registry is the shared kernel's
  `wildwinter::expr::ScopeRegistry`, the same type the Storylet Engine takes, so a game running both
  hands one registry to each; include `Patter/Kernel.h` where you make it, with
  `bEnableExceptions = true` in that module's Build.cs. Both plugins must be built from the same
  kernel (a mismatch is a compile error naming the fix). See
  [the Unreal guide](https://patterkit.dev/play/unreal/#one-registry-per-game).
- **Audio**: `UPatterAudioResolver` reads the `patteraudio.json` manifest exported next to a Patter
  audio folder and resolves each line to its winning take - it resolves the path, you play
  it. See [the audio guide](https://patterkit.dev/play/audio/).
- **Live state**: the editor module adds **Window ▸ Tools ▸ Patterplay Runtime State**;
  register a running engine with `Engine->RegisterForDebug(...)` to watch and edit its
  `@patter` properties in Play mode.
- **Live Link**: `FPatterDebugLink` connects a running game to Patterpad, streaming the story
  cursor to the editor; `ApplyLiveBundle` hot-reloads an edited bundle into the running
  engine. See [Live refresh & debug](https://patterkit.dev/play/live-debug/).
- **Structure**: `GetOutline` / `GetBeatSequence` expose the authored tree (per-beat text,
  character, speaker qualifier, resolved `PadAfter` and any `OwnPadAfter`, gameData, tags, plus each scene's and block's own gameData) for tooling like
  Sequencer binding. In C++, `Engine->Raw()->gameDataForScene` / `gameDataForBlock` read a scene's or
  a block's own gameData by address, raw (not merged with the declared defaults).

Changes per release: [CHANGELOG.md](CHANGELOG.md).
