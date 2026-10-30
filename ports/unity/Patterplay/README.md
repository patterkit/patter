# Patterplay for Unity

Play [Patter](https://patterkit.dev/) branching dialogue natively in Unity.
Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Publish Bundle* or the
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
        case StepType.Line:   /* show step.SpeakerLabel + step.Text */  break;
        case StepType.Text:   /* show step.Text */                      break;
        case StepType.GameEvent: /* fire step.GameData cues */          break;
        case StepType.Choice: flow.Choose(step.Options[0].Id);          break;  // your UI picks
        case StepType.End:    return;
    }
}
```

Render each step into your own dialogue UI; on a `Choice`, present `step.Options` (each has a
`Prompt` and an `Eligible` flag) and call `flow.Choose(id)` with the player's pick.

A line step carries its speaker as `Character` (the cast token) and `CharacterName` (the shown name), its
`Direction`, and, when the writer gave it one, a speaker qualifier: `Qualifier` is the qualifier's `gameId`
(`vo`, `os`, `radio`), for your code to switch on, and `QualifierName` its shown name (`V.O.`), localised as
`CharacterName` is. What a qualifier means for your game is yours.

To show who's speaking, use `SpeakerLabel`, so you don't put the names together yourself. It's the
character's shown name, and with a qualifier the project's speaker pattern filled in (`You (V.O.)` by
default), or the character's own label for that qualifier when the writer gives one ("Your thoughts"). Each
piece is translated, the pattern included, so a language can change the order and the punctuation. A choice
option's line `Prompt` and `BeatInfo` (at the source language) carry it too. It's null with no speaker, on a
line closed captions have silenced, and in an IDs-only bundle, where your game maps the tokens itself.

A line or text step also carries `PadAfter`, the writer's pause after it in seconds, already resolved from
the beat's own value and the defaults above it (`Bundle.DefaultPadAfter`, 0.6, when nothing sets one). A
negative value means the next line (or game event) starts that long before this one ends; only a snippet's
last line or text beat is never negative. A choice option's `Prompt` carries its `PadAfter` too, for a game
that voices the prompts itself. When your game times lines itself, follow the
[timing rules](https://patterkit.dev/play/engine/#step-shapes) the writer expects. A game event step
carries none. `GetOutline` and `GetBeatSequence` report the same `PadAfter` on a line or text
beat's `BeatInfo`, with `OwnPadAfter` when the beat sets its own. For a line with no recording,
`Bundle.EstimateLineDuration(text)` gives how long it lasts, in seconds: Patter's one rule, the same in every
runtime and in Patterpad's Play window.

A text step with `Action` set is action: a direction for whoever stages the scene, such as "MARA turns
away.", that the player never sees. It's a dialogue scene's text when the project doesn't localise it, and its
`Text` is the source in every locale. Use it to stage the scene, or ignore it, but don't show it as on-screen
text. A text step without it is shown text, as is a prompt spoken back.

To show a line again that your game kept by its id (after a load, or a language switch), call
`flow.StepFor(beatId)`. It gives the step the flow would deliver for that beat right now, built as `Advance`
builds it: the text in the active locale, interpolated against the flow's values, closed captions applied, the
names and `SpeakerLabel`, `PadAfter`, Game Data, and tags. It doesn't move the flow, count a visit, or run an
effect, and it's null for an id that's neither a beat nor an option's prompt.

A step's `GameData` is the writer's own values for that beat, raw and sparse: what the beat sets, and nothing
it leaves to the field's default. It's your own copy, as are a step's `Tags`, so editing one changes nothing
the engine hands out next. `Extensions` aren't copied: treat them as read-only. `GameDataHelpers.EffectiveGameData(GameDataHelpers.GameDataFields(bundle,
"line"), step.GameData)` fills in the defaults. A choice option, and each scene and block
(`engine.GameDataForScene`, `engine.GameDataForBlock`), carry theirs the same way.

When the project takes Patter extensions, a tool's own fields on the story's nodes, a step, a choice option,
and the outline's beats, blocks, and scenes also carry `Extensions`: each extension's values by its id, raw as
the bundle wrote them, as a neutral tree (`OrderedMap<string, object>`, `List<object>`, `double`, `string`,
`bool`, or null), and null when the node has none. The engine never reads them. Fill in an extension's
defaults with `GameDataHelpers.EffectiveGameData(GameDataHelpers.ExtensionDecls(bundle, "lighting", "line"),
step.Extensions?.GetOrDefault("lighting"))`. `engine.ExtensionsForScene`, `engine.ExtensionsForBlock` and
`engine.ExtensionsForSnippet` read a scene's, a block's and a snippet's own, and `GameDataHelpers.ExtensionsOf(bundle, kind, address)` reads any node's: the
project's (no address), a scene's, a block's (`"scene/block"`), or a snippet's, an option's or a beat's by its
id.

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
  restore the whole run as JSON (the family's `patter/save@0`, version 4; version 3 saves still
  load). A pending choice is saved by its options' ids, so it loads in the language of the engine
  that loads it. A save loaded into an edited build resumes at the nearest safe point, and says so
  through `EngineOptions.OnError` (kind `"save"`).
- **Where a flow starts**: `engine.OpenFlow("main")` with no scene starts at the project's start
  (`Bundle.Start`), else at the first scene.
- **Problems the engine carried on past** reach `EngineOptions.OnError` as a `PlayError`: content that
  failed at run time, a set-up problem (`"setup"`: a locale the bundle doesn't have, a host scope it
  doesn't declare), a moved save (`"save"`), and a choice that ran dry and so ended the flow
  (`"dry-choice"`). Without a handler, each is a `[Patterplay]` warning.
- **Why a flow ended**: an `End` step's `Reason` is `EndReason.Ended`, or `EndReason.RanDry` when a choice
  ran dry (no option left to take, and no fallback) with nothing played after it, so the flow ended there:
  a hub whose options were all used, say. That case is also reported once through `OnError`, its `Node`
  the choice group. A dry choice that play carries on past is the gather idiom and stays silent (only
  `EngineOptions.OnDryChoice` hears it). The reason survives a save and load; the host's `Goto("END")` is a
  plain `Ended`. The thin runner passes it on: `PatterRunner.Ended` is an `Action<EndReason>`, and
  `PatterRunnerBehaviour.OnEnded` a `UnityEvent<EndReason>`, so a game can tell a story that ran out from
  one that finished.
- **Set one flow aside**: `engine.CaptureFlow(id)` returns its part of a save as a `FlowState` (its
  position, PRNG, visits, selectors, and its own property values, without its id). Close the flow after
  capturing, keep the state as JSON with `PatterSave.SaveFlowState` / `ReadFlowState`, and
  `engine.RestoreFlow(newId, state)` opens it again later, under any id, without rewinding shared state.
- **Your game's state**: bind `@world` through `EngineOptions.HostScopes` (an `IHostScope` per
  token), or leave it unbound and the engine self-backs it from the declared defaults, and saves it.
  `SetProperty` refuses, by throwing, a value that doesn't fit the property's declaration or a name
  the content doesn't declare.
- **One registry per game**: every property lives in a `ScopeRegistry`. Pass your own through
  `EngineOptions.Registry` to share it with another engine (a Storylet Engine, say) and save it once
  with `PatterSave.SaveRegistry` / `LoadRegistry`; leave it out and the engine keeps its own.
  See [the Unity guide](https://patterkit.dev/play/unity/#one-registry-per-game).
- **The shared kernel**: the registry and the value type, `ExprValue`, are in the `Wildwinter.Expr`
  namespace, in the `Patterplay.Expr` assembly, shared with the Storylet Engine so a game with both
  compiles it once. A game assembly definition that references `Patterplay.Runtime` also references
  `Patterplay.Expr` and `StoryletEngine.Expr`.
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
  IDs-only bundle and localise in your own system. A locale the bundle doesn't have falls back to its
  language, then to the default, and is reported; `engine.Locale` is the one in use, and
  `engine.Locales` the bundle's.
  See [the localisation guide](https://patterkit.dev/play/localisation/).

Changes per release: [CHANGELOG.md](CHANGELOG.md).
