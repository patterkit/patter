---
title: Unreal
description: Play a Patter bundle in Unreal with the native C++ plugin, drive the flow from C++ or Blueprint, and watch live state.
sidebar:
  label: Unreal
---

Patterplay for Unreal is the **native C++ Patterplay runtime**, wrapped in a Blueprint- and
C++-friendly plugin. It loads a `.patterc` [bundle](/format/overview/) and plays it
directly: same bundle, same behaviour, held to the same
[shared test suite](/compatibility/) as every other engine.

> Verified on Unreal Engine 5.7.4 and 5.8.3, and builds from source against any 5.7 or 5.8 release
> (it is not locked to one point version). Usable from C++ or Blueprint; some engineering is expected.
>
> On a Mac, Unreal 5.7 accepts Xcode only up to 26.9. With Xcode 27, use Unreal 5.8, or keep an
> Xcode 26.x beside it and point 5.7's build at that one.

## Install

The release zip (from the `play-unreal-v*` Release: see the
[downloads page](/download/)) contains **two sibling folders**: the **`Patterplay/`**
runtime plugin, and **`PatterplayDemo/`**, a ready-to-open **sample project**. To try
Patterplay first, just open `PatterplayDemo.uproject` where it sits, and it finds the plugin in
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
UPatterEngine* Engine = UPatterEngine::Create(Bundle, {});      // Bundle: a UPatterBundle*; {}: no host scopes bound
UPatterFlow*   Flow   = Engine->OpenFlow(TEXT("main"), TEXT("intro"));

FPatterStep Step = Flow->Advance();   // Step.Type, Step.Text, Step.Character, Step.Options
// Render Step by its kind (line / text / game event / choice / end). On a choice,
// present Step.Options (each has its Prompt, with its Kind and Text, and an eligibility flag), then:
Flow->Choose(Step.Options[0].Id);     // your UI chooses; here, the first option
```

The same `UPatterEngine` / `UPatterFlow` API is exposed to **Blueprint**, with `FPatterStep` and
`FPatterOption` as Blueprint structs, so a designer can drive the flow and bind steps to a
dialogue widget without touching C++. It is the API the other runtimes have, under the same names:
a flow's `GetChoices`, `GetProperty` and `SetProperty` (its `@scene` values included), `Log`,
`Interpolate` and `StripCaptions`; and the engine's `Flows`, addresses, tags, Game Data, and
`OpenFlow` with a block and a seed. A step's `bHasCharacter`, `bHasCharacterName`,
`bHasDirection`, `bHasQualifier`, `bHasQualifierName`, and `bHasSpeakerLabel` tell a field that isn't set
from one that is empty. `Qualifier` is the line's [speaker qualifier](/setup/cast/#speaker-qualifiers) by
its `gameId` (`vo`, `os`, `radio`), and `QualifierName` its localised shown name; a line prompt carries
both too. Show `SpeakerLabel` as the speaker's name: it's localised and already puts the two together the
way the writer and the translator chose (see [How a qualified speaker is shown](/setup/cast/#how-a-qualified-speaker-is-shown)).
`PadAfter` is the writer's pause after a line or text step, in seconds, already resolved. It's always
set on a `Line` or `Text` step and 0 on any other, so it has no `bHas` flag. The
[timing rules](/play/engine/#step-shapes) say how to play it. A `Text` step with `bAction` set
(`action` on the C++ `StepResult`) is [action](/play/engine/#step-shapes), a direction for whoever
stages the scene: stage it, or let it pass, but don't show it as on-screen text. It's false on any
other step and on a replayed prompt.

`OpenFlow` with an empty scene, or a flow's `Reset`, starts at the project's start scene (and block), the
one the writer set; a project that sets none starts at its first scene.

Blueprint can't catch what the engine throws, so a refused call says so in the open. A flow keeps the reason
its last `Advance`, `AdvanceToStop`, `Choose`, `Goto`, or `Reset` was refused in **`GetLastError`** (empty when
it wasn't, and cleared by the next one that succeeds). Each `SetProperty*` returns `""` when the write
landed and otherwise why it didn't: a value that doesn't fit the property's declaration
(`"@patter.gold" takes a number; "lots" doesn't fit`), or a name the content doesn't declare. Every refusal
is also logged to the plugin's **`LogPatterplay`** category.

To choose how the engine plays, create it with **`UPatterEngine::CreateWithOptions`** and an
`FPatterEngineOptions`: a seed for a repeatable run, the locale to play in, a decision log (read it
with `Log`), whether a chosen option's prompt is spoken back, and whether closed captions start on.
The engine's **`OnDryChoice`** event fires whenever a choice has nothing left to offer.

```cpp
FPatterEngineOptions Options;
Options.Locale = TEXT("fr");
Options.bLog = true;
UPatterEngine* Engine = UPatterEngine::CreateWithOptions(Bundle, Options, {});
```

`Locale()` is the locale in use and `Locales()` the bundle's default and included locales. The `Locale`
option and `SetLocale` resolve a locale by one rule, the same on every runtime: case and `_` / `-` don't
matter, so the locale itself wins, then its language (`fr` for `fr-FR`), then the default, whose text is
marked `<Untranslated: id>`. Each fallback is reported. A choice already on screen follows `SetLocale`
too.

The engine's **`OnError`** event hears every problem it carried on past (an `FPatterPlayError`): a content
error, a `Setup` problem (a locale the bundle doesn't have, a host scope it doesn't declare), or a `Save`
report (a load whose place has gone from this build). `OnError` can only be bound once `Create` has
returned, so a `Setup` problem found while the engine is made is logged and put in the decision log at
once, and reaches `OnError` on the first `OpenFlow`.

The **PatterplayDemo** sample project (the second folder in the release zip) holds two working
references. Press **Play** in it and **`ATourDemoActor`** runs the complete interactive Patter
tour in a UI overlay (a scrolling transcript with clickable choices), loading its bundle from
disk, so a fresh unzip plays with no setup. **`APatterplayDemoActor`** is the minimal shared
demo flow (the smallest render-and-choose loop, logged) to read first. The tour actor also
shows per-line audio resolution via `UPatterAudioResolver`; audio files are not bundled (playback is
your platform call), so point its **Audio Root** at a Patter audio folder to hear it, or leave
it empty to play silently.

## Your game's state

Give the engine your `@world` values in a **`UPatterWorld`** when you create it, in the host-scopes map
under the scope's token. The story reads them through it before every condition, effects write back into
it, and anything else you bind to the same object, your own systems or the Storylet Engine's
`UStoryletWorld`, sees the same values:

```cpp
UPatterWorld* World = NewObject<UPatterWorld>(this);
World->SetString(TEXT("time_of_day"), TEXT("night"));
World->SetBool(TEXT("knows_road"), false);
World->SetReadOnly(TEXT("time_of_day"), true);   // yours alone: a story write is refused
UPatterEngine* Engine = UPatterEngine::Create(Bundle, { { TEXT("world"), World } });

World->OnChanged.AddDynamic(this, &AMyActor::OnWorldChanged);   // (Name, Value, bFromStory)
```

Everything on `UPatterWorld` is Blueprint-callable, with typed `Set*` / `Get*`, `Has`, `Names`,
`SetReadOnly`, and an `OnChanged` delegate that tells your own writes from the story's. Names match
case-insensitively, as the story's references do. The engine registers a bound world as an
**external** scope: the values stay in your container, and no Patter save holds them. Leave `world`
out of the map and the engine **self-backs** `@world` from the declared defaults, as a property it
stores and saves with the rest of the run, which is right for a run that never leaves the engine;
`GetHostScope(TEXT("world"))` says which you have. The map binds any host scope the project declares,
by its token, in the same way. Tokens are case-sensitive: one the bundle doesn't declare (`World` for
`world`) is reported through `OnError` as a `Setup` problem, naming the declared spelling, and never folded.

Two read-only rules meet here and stay distinct. A property declared **`writable: false`** in the
project is the *story's* promise, refused by the engine whether or not a world is bound. Only
the story's write is refused; your own `SetProperty` writes it, because the value is the game's.
**`SetReadOnly`** is the *game's* policy, a name the story may read but this game will not let it
write. Either refusal is played through and reported through `OnError`, never a crash, and neither binds
your own `Set*` calls. A bound container is never in a Patter save, so your game saves it once, however it already
saves things, and a load never writes through it. The binding survives `HotSwap` and `ApplyLiveBundle`.
It's the same option every Patterplay runtime takes (JS `hostScopes`, Unity `EngineOptions.HostScopes`,
Godot `host_scopes`). [World Properties](/play/world-properties/) has the full picture.

## One registry per game

Every property value lives in a **registry**, a `patter::ScopeRegistry` (the plugin's
`Patter/Expr/ScopeRegistry.h`, the same registry every Patterplay runtime uses). A game has one, and
it holds every property in the game, except values your game keeps itself and lends through a
container like `UPatterWorld`. The registry is saved and loaded as one.

An engine you build with `Create` makes its own and acts as its own game, which is why a single
`UPatterSave::SerializeState` needs no wiring. A C++ game that wants to hold the properties itself,
or share them with its own systems, makes the registry and hands it to the engine with
**`UPatterEngine::CreateWithRegistry`**:

```cpp
#include "Patter/Save.h"   // patter::saveRegistry / loadRegistry

auto Registry = std::make_shared<patter::ScopeRegistry>();
patter::ScopeDeclaration Gold;
Gold.name = "gold";
Gold.type = "number";
patter::OwnedScopeOptions Game;
Game.owner = "Game";
Registry->defineOwned("world", { Gold }, Game);   // @world, stored and saved
UPatterEngine* Engine = UPatterEngine::CreateWithRegistry(Bundle, Registry);

// One save for the game: the registry's values once, and the engine's part.
const std::string RegistryJson = patter::saveRegistry(*Registry);
const FString PatterJson = UPatterSave::SerializeState(Engine);

// Load in either order: values for bags that aren't open yet wait in the registry.
patter::loadRegistry(*Registry, RegistryJson);
UPatterSave::DeserializeState(Engine, PatterJson);
```

Given a registry, the engine registers `@patter` under `patter` and each flow's and scene's bag under
a key starting `patter/`, which no expression can name. Its save then leaves the values out, because
your game saves the registry. `@world` is yours to register: owned, as above, when the registry should
store and save it, or bound through a `UPatterWorld` in the host-scopes map passed as the third argument,
when your game keeps the values. The engine self-backs nothing on a registry you pass. Every expression can read
every registered scope.

**Other engines' scopes need no setting.** A Patter line can name the Storylet Engine's `@story.act`
(in a condition, an effect, or a `{@story.act}` slot) in any project: the compiler lets it through
without checking its names, since the Storylet Engine owns them, and lists it in the bundle. Only the
other engine's shared values are visible. If no engine on Patterplay's registry registered that
scope, Patterplay refuses the content before anything changes: `OpenFlow` returns null and
`UPatterSave::DeserializeState` returns false, each logging `this content names @story, which no
engine on this registry registered: give every engine the game's one registry` as an error. So build
every engine on the game's one registry before opening a flow or loading a save. If another engine
takes its scope away mid-game, a write to it fails naming the scope rather than landing in `@patter`.

A token is taken once. Two engines that both want the same one fail as you build the second:
`CreateWithRegistry` returns null and logs an error that names who got there first, and your registry
is left as it was. Rebuilding an engine on an edited bundle (`HotSwap`, `ApplyLiveBundle`) hands its
bags to the replacement on the same registry.

`CreateWithRegistry` is C++ only: the registry is a standard C++ object shared by pointer, and no
Blueprint pin carries one. A Blueprint game uses `Create`, and `UPatterSave` saves everything. In the
core, the same option is `patter::EngineOptions::registry`.

### With the Storylet Engine

`patter::ScopeRegistry` is the shared expression kernel's `wildwinter::expr::ScopeRegistry`, and the
Storylet Engine plugin carries the same kernel, byte for byte. In a game with both plugins,
`patter::ScopeRegistry` and `storylets::ScopeRegistry` are one type, so the registry above goes to
`UStoryletEngine::CreateWithRegistry` too, and each engine reads the other's scopes through it.

- **Build both plugins from the same kernel.** Their headers are compiled into your game module, so
  if one plugin is older, the module that includes both stops at a compile error that says so.
  Update the older plugin.
- **The module that makes the registry needs exceptions**: `bEnableExceptions = true` in its
  `Build.cs`, and `#include "Patter/Kernel.h"`, since the registry refuses by throwing. A module
  that only calls `UPatterEngine` needs neither.
- **Errors.** The engine reports every refusal as `patter::EvalError`, as it always has; a call you
  make on the registry yourself throws the kernel's `wildwinter::expr::RegistryError`.

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
UPatterEngine* Engine = UPatterEngine::Create(Bundle, {});
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
Link = FPatterDebugLink::Create(Engine->BuildId(), TEXT("My Game"));   // Link: TSharedPtr<FPatterDebugLink>
Link->FlowOpened(TEXT("main"));
// ...after each Advance()/Choose(); TypeName spells the step's type as the wire does ("line", "gameEvent", ...):
Link->Observe(TEXT("main"), Flow->CurrentScene(), Step.Id, FPatterDebugLink::TypeName(Step.Type));
```

The protocol and the editor side are on [Live refresh & debug](/play/live-debug/).

## Save and load

The runtime serialises the whole run: every flow's position, visit counts, selector cursors, and the
seeded random generator. An engine you built with `Create` also carries every property value,
`@patter`, `@scene`, and a self-backed `@world` alike, so one call is still the whole game; an engine
you built on your own registry leaves them to [the registry's save](#one-registry-per-game). It is the
same `patter/save@0` format every Patterplay runtime uses, so a save written on the web or in Unity
loads here. Saves are version 4: a pending choice keeps which options it offered, not their text, so
they're shown in the loading engine's language, and the save names the next line by its id. A save loaded
into an edited build resumes at the nearest safe point and is reported through `OnError` as `Save`. A
version 3 save, from before 1.0, still loads; a version 2 save no longer does.

Use **`UPatterSave`**, which is Blueprint-callable and gives you the JSON to write where you like:
`SerializeState(Engine)` returns it, `DeserializeState(Engine, Json)` restores it and returns
whether the file was accepted (a refusal is logged with its reason).

Prefer it over reaching past the wrapper. Loading REBUILDS the engine's flows, so any `UPatterFlow`
you are holding refers to a flow that no longer exists; `UPatterSave` re-binds your wrappers to the
restored flows for you, and a flow the save did not carry comes back closed rather than dangling.
Calling `loadGame()` on the core engine through `UPatterEngine::Raw()` skips that step. [Save/load & Game Data](/play/integration/) covers the format.

To set one flow aside instead, `UPatterEngine::CaptureFlow(Name)` returns its part of a save as JSON, and
`RestoreFlow(Name, Json)` opens it again later as a new `UPatterFlow`, under that name or another (null, and
logged, if it is refused). See [Taking one flow out](/play/integration/#taking-one-flow-out).

## Build against the writer's structure

`UPatterEngine::GetOutline()` and `GetBeatSequence()` expose the authored tree (scenes → blocks →
snippets → beats) as Blueprint structs, without playing. Walk the flat beat list and read each beat's
`GameData` to build, say, a **Sequencer of subsequences**, one per beat. [Structure introspection](/play/structure/) describes both calls.

## Next

- [The play loop](/play/concepts/) is the shared model.
- [Host navigation](/play/navigation/) drives the story from the game.
- [Save/load & Game Data](/play/integration/) covers Game Data, tags, host events, and localisation.
- [Compatibility & conformance](/compatibility/) explains why it matches the other engines exactly.
