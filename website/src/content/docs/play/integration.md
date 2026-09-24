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
| Switch language live | `engine.setLocale("fr")` | `engine.SetLocale("fr")` | `Engine->Raw().setLocale("fr")` | `engine.set_locale("fr")` |

Save/load differs per engine (see each engine guide's *Save and load*).

## Save and load

One call snapshots the whole game; one restores it:

```ts
const save = engine.saveGame();   // a plain serialisable object (version 3)
// ...later...
engine.loadGame(save);
```

The snapshot holds everything needed to resume: world and per-flow visit counts, selector cursors
and shuffle bags, each flow's position and call/return stack, the PRNG position, and any pending
choice (saved as its exact option set and replayed verbatim on load, so conditions aren't
re-evaluated and the PRNG never double-draws). An engine you built on its own also carries every
property value, `@patter`, `@scene`, and a self-backed `@world` alike, so one call is still the
whole game. **Locale is not in the save**: it's presentation, not game state. A saved position
that points at content you've since deleted resumes best-effort rather than throwing.

**Every runtime writes and reads the same save format**, `patter/save@0`, so a save crosses
engines. A game that saves from a web build loads in Godot, and a Patterpad Play-window save loads
in Unity. The shape is the JS runtime's, documented in `@patterkit/model`, and the conformance corpus
holds every engine to it by carrying a save the JS runtime wrote that each engine must load, write
back in the same shape, and continue. Semantically equivalent is the promise, not byte-identical.
Key order and number formatting can differ between engines, and nothing should compare the text.
A save written before property values moved into the registry (version 2) still loads on every
runtime, and its values move into the registry as it does.

The **`@patterkit/play-helpers`** package wraps this for storage:

```ts
import { serializeState, deserializeState } from "@patterkit/play-helpers";

localStorage.setItem("save", serializeState(engine));   // → a JSON string in an envelope
deserializeState(engine, localStorage.getItem("save"));
```

## One registry per game

Every property value lives in a **registry**, a `ScopeRegistry` from
[`@wildwinter/scoperegistry`](https://www.npmjs.com/package/@wildwinter/scoperegistry). A game has
one, and it holds every property from every engine in the game, except values your game keeps
itself and lends through a resolver. The registry is saved and loaded as one.

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
refuses that content for the same reason. The list of these tokens is shared by every engine in the family, so combining them
never needs wiring.

A token is taken once. Two engines that both want the same one fail as you build the second,
with an error that names who got there first. Rebuilding an engine on an edited bundle
(`hotSwap`) hands its bags to the replacement on the same registry.

## Reading Game Data

In practice you read one field: **`step.gameData`** off each beat as it plays. The runtime has
already merged the node's overrides onto the schema defaults, so it's a plain object of resolved
values:

```ts
if (step.type === "line" && step.gameData?.portrait) showPortrait(step.gameData.portrait);
```

The native ports carry the same field on their step: `step.GameData` (Unity), `Step.GameData`
(Unreal, an array of name/type/value entries at the Blueprint boundary), `step.get("gameData")`
(Godot).

For tooling or an out-of-band lookup (a node you have but aren't currently playing), the
bundle-walking helpers (also on the `window.Patterplay` drop-in) resolve values directly:

```ts
import { gameDataFields, gameDataValue, effectiveGameData } from "@patterkit/runtime";

const fields = gameDataFields(bundle, "line");
gameDataValue(fields, node, "portrait");   // this node's value, or the field default
effectiveGameData(fields, node);           // every field resolved into one object
```

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
