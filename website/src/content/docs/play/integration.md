---
title: Save/load and Game Data
description: Save and load a run, read Game Data off each step, and handle host events, the same way on every Patterplay runtime.
sidebar:
  label: Save/load and Game Data
---

Once you can [advance a flow](/play/concepts/), this page covers **saving and loading** a run
and reading your own **Game Data** off each step (plus host events, which ride on Game Data). The calls
below are shown in JavaScript, but every engine exposes the same shape. Other runtime topics have their
own pages, [linked at the end](#more-runtime-topics).

**The same calls in your engine.** You only ship on one engine, so here is the local naming for the
operations you reach for most (see your engine's [guide](/play/overview/) for the rest):

| Operation | JavaScript | Unity (C#) | Unreal (C++) | Godot (GDScript) |
|---|---|---|---|---|
| Advance the flow | `flow.advance()` | `flow.Advance()` | `Flow->Advance()` | `flow.advance()` |
| Read a step's Game Data | `step.gameData` | `step.GameData` | `Step.GameData` | `step.get("gameData")` |
| Get / set a property | `flow.getProperty` / `setProperty` | `flow.GetProperty` / `SetProperty` | `Engine->GetPropertyNumber` / `SetPropertyNumber` | `flow.get_property` / `set_property` |
| Order a quality's stages | `engine.compareStages(ref, a, b)` | `engine.CompareStages(ref, a, b)` | `Engine->CompareStages(Ref, A, B, Order)` | `engine.compare_stages(ref, a, b)` |
| Switch language live | `engine.setLocale("fr")` | `engine.SetLocale("fr")` | `Engine->Raw()->setLocale("fr")` | `engine.set_locale("fr")` |
| Set one flow aside, and bring it back | `engine.captureFlow(id)` / `restoreFlow(id, state)` | `engine.CaptureFlow(id)` / `RestoreFlow(id, state)` | `Engine->CaptureFlow(Name)` / `RestoreFlow(Name, Json)` | `engine.capture_flow(id)` / `restore_flow(id, state)` |

Save/load differs per engine (see each engine guide's *Save and load*).

## Save and load

One call snapshots the whole game; one restores it:

```ts
const save = engine.saveGame();   // a plain serialisable object (version 4)
// ...later...
engine.loadGame(save);
```

The snapshot holds everything needed to resume: world and per-flow visit counts, selector cursors
and shuffle bags, each flow's position and call/return stack, the PRNG position, and any pending
choice (saved as its exact option set and replayed verbatim on load, so conditions aren't
re-evaluated and the PRNG never double-draws). An engine you built on its own also carries every
property value, `@patter`, `@scene`, and a self-backed `@world` alike, so one call is still the
whole game. **Locale is not in the save**: it's presentation, not game state. A pending choice keeps
which options it offered, not their text, so a save loaded into an engine in another language shows the
choice in that language. (A prompt that `replayPromptOnChoose` is still to speak back is the exception:
it's kept as the player saw it.)

### Loading a save into an edited build

A save names its place by id: the snippet, the next beat in it, and the next child of every block and
group on the way down. So a patch that adds, moves, or rewords content around a player's place doesn't
move them. When the place itself has gone, the flow resumes at the nearest safe point:

- **The snippet has gone**: play carries on after it, from what survives around it.
- **The next beat has gone from a snippet that's still there**: the snippet ends there (its exit effects
  run and its jump is followed), so nothing plays twice.
- **The option the player was inside has gone**: its choice is offered again, without it.
- **Every option of a pending choice has gone**: the choice is offered again with the options it has
  now, or, if the choice itself has gone, play carries on after it.

Each of these is reported to `onError` as a `save` problem (see
[When something goes wrong](/play/engine/#when-something-goes-wrong)), and only these: a load that finds
its place has nothing to say.

A saved value that the content no longer allows goes back to its default as the save loads: a stage
you've deleted from a quality, an enum value or a flag you've removed, or a value of a type the
property no longer has. Otherwise the first condition that ordered that quality would fail. Each one
is reported, so a save that drifted is never silent: pass `onRefit` to hear about them. Each says
where it was (`scope`, the registry key such as `patter`), its `name`, and what the save held.

```ts
const engine = new Engine(bundle, {
  onRefit: (misfits) => { for (const m of misfits) console.info(`${m.scope}.${m.name} was ${m.value}; now its default`); },
});
```

| Runtime | How to hear about it | Unset |
|---|---|---|
| JS | `onRefit` in the engine options | `console.warn` |
| Unity | `EngineOptions.OnRefit` (a list of `LoadMisfit`) | `Debug.LogWarning` |
| Unreal | the engine's `OnRefit` event (scope, name, saved value); `EngineOptions::onRefit` in C++ | a log warning |
| Godot | `"on_refit"` in the options, a `Callable` taking an Array of Dictionaries | `push_warning` |

A game that keeps one registry for several engines loads it itself; pass `{ refit: true }` to that
load too (`registry.load(save.registry, { refit: true })`), and the engine reports what was put back as
its own scopes claim their values.

**Every runtime writes and reads the same save format**, `patter/save@0`, so a save crosses
engines. A game that saves from a web build loads in Godot, and a Patterpad Play-window save loads
in Unity. The shape is the JS runtime's, documented in `@patterkit/model`, and the conformance corpus
holds every engine to it by carrying a save the JS runtime wrote that each engine must load, write
back in the same shape, and continue. Semantically equivalent is the promise, not byte-identical.
Key order and number formatting can differ between engines, and nothing should compare the text.
Every runtime reads saves of version 3 and 4, and writes version 4. A version 3 save's pending prompt
text is discarded as it loads, since prompts are built in the language in use. Saves of version 2, from
before property values moved into the registry, no longer load.

The **`@patterkit/play-helpers`** package wraps this for storage:

```ts
import { serializeState, deserializeState } from "@patterkit/play-helpers";

localStorage.setItem("save", serializeState(engine));   // → a JSON string in an envelope
deserializeState(engine, localStorage.getItem("save"));
```

### Taking one flow out

A whole-game save is the usual thing to keep. When a game wants to set one conversation aside instead (a
bark cut short, or an exchange the player walked away from) and perhaps carry it on later, it can take that
flow out as data and close it:

```ts
const held = engine.captureFlow("bob");   // plain data: the flow's place and its own values
engine.closeFlow("bob");
// ...later, in this session or after a save and load...
const flow = engine.restoreFlow("bob-again", held);
```

`captureFlow(id)` returns the flow's part of a save: its position (a pending choice included), its PRNG, its
own visit counts and selector cursors, and the values of its own properties (its flow-local `@patter`
properties, and its own `@scene` values for every scene it has been in). The flow's id isn't in it, so it can
come back under any id. **Capture before you close**: closing a flow drops its values. Capturing only reads,
so it works while a checkpoint is open.

`restoreFlow(id, state)` opens a flow under `id` from that data, the way `loadGame` restores each flow.
Shared state isn't in a captured flow, so restoring one never rewinds anything else: global properties and
shared scene properties keep whatever other flows did in the meantime. Against an edited bundle it finds its
place by id, as a load does. It refuses an id that is already open, a state it can't read, and any restore
while a checkpoint is open, changing nothing. The data is in the same format on every runtime, and your game saves it however
it likes.

## One registry per game

Every property value lives in a **registry**, a `ScopeRegistry` from
[`@wildwinter/scoperegistry`](https://www.npmjs.com/package/@wildwinter/scoperegistry). A game has
one, and it holds every property from every engine in the game, except values your game keeps
itself and lends through a resolver. The registry is saved and loaded as one.

Import it from the package itself. Every Patterkit package takes it as a peer dependency, so your
game and each engine are on the same copy, and a registry your game makes is the one the engines
use.

An engine you build without one makes its own and acts as its own game, which is why the one-call
save above needs no wiring. A game that runs more than one engine, or that wants to hold the
properties itself, makes the registry and hands it to each engine:

```ts
import { ScopeRegistry } from "@wildwinter/scoperegistry";

const registry = new ScopeRegistry()
  .defineOwned("world", worldDeclarations, { owner: "Game" });   // @world, stored and saved
const patter = new Engine(bundle, { registry });

// One save for the game: the registry's values once, and each engine's part.
const save = { registry: registry.save(), patter: patter.saveGame() };

// Load in either order: values for bags that aren't open yet wait in the registry.
registry.load(save.registry);
patter.loadGame(save.patter);
```

Given a registry, the engine registers `@patter` under `patter` and each flow's and scene's bag
under a key starting `patter/`, which no expression can name. Its `saveGame()` then leaves the
values out, because your game saves the registry. `@world` is yours to register: owned, as above,
when the registry should store and save it, or foreign, with a resolver, when your game keeps the
values. Every expression can read every registered scope.

**Other engines' scopes need no setting.** A Patter line can name the Storylet Engine's
`@story.act` (in a condition, an effect, or a `{@story.act}` slot) in any project: the compiler
lets it through without checking its names, since the Storylet Engine owns them. Only the other
engine's shared values are visible. Content that names another engine runs only where that
engine is on the same registry: without it, `openFlow` and `loadGame` refuse, naming the token,
before anything changes. A tool that runs Patter alone, such as a preview or a coverage run,
refuses that content for the same reason, unless the game shares its scopes: with a
[`game-scopes/` folder](/setup/properties-and-data/#sharing-scopes-with-the-games-other-tools),
the compiler checks `@story`'s names and types against the Storylet Engine's file (as warnings),
and Patterpad's Play window, `patter play`, and coverage stand `@story` in from that file's
defaults. That is a preview's convenience only: a bundle never carries another engine's
declarations, and your game still registers every engine on the one registry. A game scope that
`game.scopes.json` declares and the project doesn't (an `@player`, say) is treated the same way:
named in `externalScopes`, for your game to register. `@world` from that file is the exception,
compiled into the bundle so a standalone engine backs it from its defaults. The list of these
tokens is shared by every engine in the family, so combining them never needs wiring.

A token is taken once. Two engines that both want the same one fail as you build the second,
with an error that names who got there first. Rebuilding an engine on an edited bundle
(`hotSwap`) hands its bags to the replacement on the same registry.

## Reading Game Data

In practice you read one field: **`step.gameData`** off each beat as it plays. It holds the
author's **overrides** for that beat, exactly as stored: only the values set on the node, not the
field defaults (it's absent when the beat sets none):

```ts
if (step.type === "line" && step.gameData?.portrait) showPortrait(step.gameData.portrait);
```

The native ports carry the same field on their step: `step.GameData` (Unity), `Step.GameData`
(Unreal, an array of name/type/value entries at the Blueprint boundary), `step.get("gameData")`
(Godot).

When you want the defaults filled in, resolve the overrides against the project's field schema with
the helpers (also on the `window.Patterplay` drop-in). Every field in the bundle carries a default
(the one the project gave, else its type's, which the compiler writes in), so the resolved object has
every declared field. They work on any node's overrides, whether from a step, the accessors below,
or a node you are not currently playing:

```ts
import { gameDataFields, gameDataValue, effectiveGameData } from "@patterkit/runtime";

const fields = gameDataFields(bundle, "line");
gameDataValue(fields, step.gameData, "portrait"); // this node's value, or the field default
effectiveGameData(fields, step.gameData);         // every field resolved into one object
```

Every runtime has the same three helpers:

| | JavaScript | Unity (C#) | Unreal (Blueprint) | Godot (GDScript) |
|---|---|---|---|---|
| A node type's fields | `gameDataFields(bundle, kind)` | `GameDataHelpers.GameDataFields(bundle, kind)` | `UPatterGameData::GameDataFields(Bundle, Kind)` | `PatterBundle.game_data_fields(bundle, kind)` |
| One field's value | `gameDataValue(fields, node, name)` | `GameDataHelpers.GameDataValue(fields, node, name)` | `UPatterGameData::GameDataValue(Fields, Node, Name, Value, TypedValue)` | `PatterBundle.game_data_value(fields, node, name)` |
| Every field resolved | `effectiveGameData(fields, node)` | `GameDataHelpers.EffectiveGameData(fields, node)` | `UPatterGameData::EffectiveGameData(Fields, Node)` | `PatterBundle.effective_game_data(fields, node)` |

The Unreal C++ core has them too, as `patter::gameDataFields`, `gameDataValue`, and `effectiveGameData`. In
Blueprint, each Game Data entry carries its value twice: `Value` as text to show, and `TypedValue` (an
`FPatterValue`) to act on, so a number reads as a number without parsing it.

A **quality** field holds a stage of its own ladder, listed in order on the field's `stages`. To ask
whether a node's stage is at or past another, hand the field to the stage helpers, which compare by
position rather than by name:

```ts
import { compareStages, gameDataFields } from "@patterkit/runtime";

const act = gameDataFields(bundle, "line").find((f) => f.name === "act")!;
compareStages(act, step.gameData?.act ?? act.default, "act-1");   // -1, 0 or 1
```

The same helpers take a field on every runtime: `Stages.Compare(field, a, b)` in C# (a
`GameDataField` is a declaration), `PatterExpr.compare_stages(field, a, b)` in GDScript,
`wildwinter::expr::CompareStages(field.stages, a, b)` in C++, and `UPatterGameData::CompareStages(Field, A, B)`
in Blueprint, with `StageIndex` and `NextStage` beside each.

### Scene and block Game Data

Scenes and blocks carry Game Data too (a scene's music, a block's location or lighting), but no
step is delivered for a scene or a block, so the engine has accessors. Pass a scene or block by
internal id or by its [Game ID address](/format/gamedata-and-addressing/#the-two-ids):

```ts
engine.gameDataForScene("the-tavern");           // { music: "jig" }
engine.gameDataForBlock("the-tavern", "cellar"); // { lit: false }
```

They follow the same rule as `step.gameData`: the node's own overrides, raw, with no defaults merged
in. A block does **not** inherit its scene's Game Data (unlike [tags](/play/tags/), which build up
down the structure), so ask for each level you care about. A scene or block that sets nothing, or a
ref that doesn't resolve, gives an empty object. Each call returns a fresh copy, so changing it can't
touch the bundle. Merge defaults the same way as for a beat:

```ts
effectiveGameData(gameDataFields(bundle, "scene"), engine.gameDataForScene("the-tavern"));
```

A host typically reads them when it starts or `goto`s a flow at an address, or on a scene change.
The same overrides appear as `gameData` on each scene and block of
[`getOutline()`](/play/structure/) (left out when empty).

| | JavaScript | Unity (C#) | Unreal (Blueprint) | Godot (GDScript) |
|---|---|---|---|---|
| A scene's Game Data | `engine.gameDataForScene(scene)` | `engine.GameDataForScene(scene)` | `Engine->GameDataForScene(Scene)` | `engine.game_data_for_scene(scene)` |
| A block's Game Data | `engine.gameDataForBlock(scene, block)` | `engine.GameDataForBlock(scene, block)` | `Engine->GameDataForBlock(Scene, Block)` | `engine.game_data_for_block(scene, block)` |

In Unreal's C++ core they are `gameDataForScene` and `gameDataForBlock`.

## Host events

Patter effects are **set-only**, so "fire this now" is not an effect: it's Game Data.
Put a `sound`, `camera`, or `quest` field on a beat (typically a wordless **game event**
beat) and act on `step.gameData` when that beat arrives. This keeps all
fire-and-forget host signalling in one explicit place you control.

## More runtime topics

The rest of wiring a runtime into your game lives on its own pages:

- [World Properties](/play/world-properties/): bind your live game state so the story reads
  and writes `@world.*`.
- [Tags](/play/tags/): read the accumulated author tags off each step.
- [Formatting markup](/play/formatting/): render the bold / italic the runtime hands you.
- [Localisation](/play/localisation/): Embedded vs IDs-only, `setLocale`, and `interpolate` at
  `interpolate` at runtime.
- [The play-helpers package](/play/play-helpers/): optional save/load and property conveniences.
