# Patterplay for Unreal

Play [Patter](https://patterkit.dev/) branching dialogue natively in Unreal
Engine. Patterplay loads a compiled `.patterc` bundle (the file Patterpad's *Publish Bundle* or
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
UPatterEngine* Engine = UPatterEngine::Create(Bundle, {});      // Bundle: a UPatterBundle*; {}: no host scopes bound
UPatterFlow*   Flow   = Engine->OpenFlow(TEXT("main"), TEXT("intro"));   // an empty scene: the project's start

FPatterStep Step = Flow->Advance();   // Step.Type, Step.Text, Step.Character, Step.Options
// Render Step by its kind (line / text / game event / choice / end). On a choice,
// present Step.Options (each has prompt text + an eligibility flag), then:
Flow->Choose(Step.Options[0].Id);
```

A line step names its speaker (`Character`, and `CharacterName`, the locale-resolved name), its
`Direction`, and any speaker qualifier: `Qualifier` is the qualifier's gameId (`vo`, `os`, `radio`) for
your code to switch on, and `QualifierName` its shown name (`O.S.`). `SpeakerLabel` is the name to
show: with a qualifier, the project's speaker pattern filled in (`Tam (O.S.)`), or the character's own
label for that pair where the project gives one ("Your thoughts"); with none, the shown name. It's
translated as the names are, so show it rather than putting the name and the qualifier together yourself.
An option's `Prompt` carries the same fields, and each has a `bHas` flag for whether it is set; an
IDs-only build sets no names or label, as your game maps the tokens itself.

A line or text step also carries `PadAfter`, the pause after it in seconds, before the next line: the
line's own, else the nearest default above it (its snippet, groups, block, scene, then the project's),
else the built-in 0.6. A negative value starts the next line that long before this one ends (a cut-in);
only a snippet's last line is never negative (a negative pause before a game event stands). An option's
`Prompt` carries its pause too, as `PadAfter`, for a game that voices the prompts itself. When your game times lines itself, follow the [timing rules](https://patterkit.dev/play/engine/#step-shapes) the writer expects.
For a line with no recording, `UPatterGameData::EstimateLineDuration` (C++ `patter::estimateLineDuration`)
gives how long it lasts, in seconds: Patter's one rule, the same in every runtime and in Patterpad's Play window.

A text step with `bAction` set is action: a direction for whoever stages the scene, such as "Mara turns
away.", that the player never sees. A dialogue scene's text is action unless the project localises it, so
its `Text` is the source in every locale. Stage it (or log it) rather than showing it. An option's prompt is
never action.

To show a line again by its id (after a load, or a language switch), `Flow->StepFor(BeatId, OutStep)`
fills in the step this flow would deliver for that beat right now, exactly as `Advance` would give it (the
active locale, interpolation, closed captions, names, label, pause, Game Data, and tags), and returns
false for an id that is neither a beat nor an option's prompt. It doesn't move the flow, count a visit, or
run an effect. In C++, `patter::Flow::stepFor` returns a `std::optional<patter::StepResult>`.

The same `UPatterEngine` / `UPatterFlow` API is exposed to **Blueprint** (with `FPatterStep`
and `FPatterOption` as Blueprint structs), so a designer can drive the flow and bind steps to
a dialogue widget without touching C++.

For a straightforward game, the **Patter Runner** component (`UPatterRunnerComponent`; `patter::Runner` in
the core's `Patter/Runner.h`) turns this pull API into push events. `Begin` delivers the first beat; each
line, text, or game event arrives on `OnLine`, `OnText`, or `OnGameEvent` and waits for `Next`, and a choice
arrives on `OnChoice` and waits for `Choose`. `OnEnded` hands its handler the end's `EPatterEndReason`
(`patter::EndReason` in C++): `RanDry` when a choice had nothing left and nothing came after it, otherwise
`Ended`. The engine's save and load stay the one way to save.

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
  external) values from C++ or Blueprint - the game pushing state into the dialogue. A value that
  doesn't fit the property's declaration, or a name the content doesn't declare, is refused: each
  `SetProperty*` returns `""` when the write landed, and otherwise why it didn't, logged to
  `LogPatterplay` (`"@patter.gold" takes a number; "lots" doesn't fit`). Bind your own containers for
  the host scopes your game owns with `UPatterEngine::Create(Bundle, HostScopes)`, a map of token to
  `UPatterWorld` (`"world"` for World Properties).
- **Refusals and reports**: Blueprint can't catch what the engine throws, so a flow keeps the reason its
  last `Advance`, `AdvanceToStop`, `Choose`, `Goto`, or `Reset` was refused in `GetLastError` (cleared by
  the next one that succeeds). `OnError` hears every problem the engine carried on past: a content error,
  a `Setup` problem (a locale the bundle doesn't have, a host scope it doesn't declare), and a `Save`
  report (a load whose place has gone from this build). A `Setup` problem found while the engine is made
  is logged and recorded at once and reaches `OnError` on the first `OpenFlow`, since the event can only
  be bound once `Create` has returned.
- **A choice that runs dry**: a choice with no option left to take and no fallback never stops the story.
  It falls through to whatever follows it, and `OnDryChoice` hears its group id. When the flow then ends
  with nothing delivered since (a hub whose options have all been used, say), `OnError` hears it once as
  `DryChoice`, naming the group, and the `End` step's `EndReason` is `RanDry` rather than `Ended`. An `END`
  straight after the choice still counts. Asking `Advance` again gives the same reason without a second
  report, a save keeps it (a load doesn't report it again), and `Goto("END")` ends the flow plainly. In
  C++, the core's `patter::StepResult::reason` is `patter::EndReason::RanDry` and the report's kind is
  `"dry-choice"`. A dry choice that play carries on past stays silent.
- **Locales**: `Locale()` is the locale in use and `Locales()` the bundle's default and included locales.
  `SetLocale` (and the `Locale` option) resolves by one rule on every runtime: case and `_` / `-` don't
  matter, then the language alone (`fr` for `fr-FR`), then the default, each fallback reported. A pending
  choice's options follow the language too.
- **Save and load**: `UPatterSave::SerializeState` / `DeserializeState` write and read the
  whole run as one JSON string (save version 4; a version 3 save from before 1.0 still loads, and a
  version 2 save no longer does). A save keeps which options a pending choice offered, not their text,
  so they're shown in the loading engine's language, and names the next line by its id, so a save loaded
  into an edited build resumes at the nearest safe point, reported as `Save`.
- **Taking one flow out**: `Engine->CaptureFlow(TEXT("bob"))` returns one flow as a JSON string (its
  place, a pending choice included, and its own property values, without its name), for your game to keep
  however it likes; `Engine->RestoreFlow(TEXT("bob-again"), State)` opens a flow from it later, under the
  same name or another, in this session or after a save and load. **Capture before `CloseFlow`**: closing
  drops the flow's values. Shared state isn't in it, so restoring rewinds nothing else. `RestoreFlow`
  refuses a name that is open, and refuses while a checkpoint is open, changing nothing and answering
  null. In C++, `patter::Engine::captureFlow` / `restoreFlow` take a `patter::FlowState`, and
  `patter::serializeFlowState` / `deserializeFlowState` turn it into JSON and back. See
  [Taking one flow out](https://patterkit.dev/play/integration/#taking-one-flow-out).
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
  cursor to the editor (`FPatterDebugLink::TypeName(Step.Type)` spells a step's type for `Observe`);
  `ApplyLiveBundle` hot-reloads an edited bundle into the running engine. See [Live refresh & debug](https://patterkit.dev/play/live-debug/).
- **Structure**: `GetOutline` / `GetBeatSequence` expose the authored tree (per-beat text,
  character, speaker qualifier, speaker label, resolved `PadAfter` and any `OwnPadAfter`, gameData, tags, plus each scene's and block's own gameData) for tooling like
  Sequencer binding. Every Game Data the engine hands out (on a step, an option, the outline) is the
  game's own copy; extension values are the bundle's, and read-only. In C++, `Engine->Raw()->gameDataForScene` / `gameDataForBlock` read a scene's or
  a block's own gameData by address, raw (not merged with the declared defaults).
- **Patter extension values**: a tool's own fields on Patter's nodes reach the game where gameData does:
  `Extensions` on a line, text or game event step (a replayed prompt and `StepFor` included), on each
  option, and on the outline's scenes, blocks and beats, as `FPatterExtensionValues` (the extension id and
  its values, each an `FPatterExtensionEntry` of name and JSON text, since a value may be a record, a map
  or a list). `Engine->ExtensionsForScene` / `ExtensionsForBlock` / `ExtensionsForSnippet` read a scene's, a block's or a
  snippet's own. On
  `UPatterGameData`: `ExtensionDecls(Bundle, Extension, Kind)` gives the declarations, every default
  resolved (in `DefaultJson`, and typed as well when it's a scalar); `GetEffectiveExtensionValues` fills
  in what a node leaves out; `ExtensionsOf(Bundle, Kind, Address)` reads any node's values (the project, a
  scene, a block, a snippet, an option or a beat); `FindExtensionValue` picks one value out; and
  `ExtensionValueToScalar` turns a scalar's text into an `FPatterValue`. In C++ the values are
  `patter::NodeExtensions` over the neutral `patter::JsonTree`, with `patter::extensionDecls`,
  `extensionsOf` and `effectiveGameData` over extension declarations. A save doesn't carry them.

Changes per release: [CHANGELOG.md](CHANGELOG.md).
