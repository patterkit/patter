---
title: Save/load & Game Data
description: The integration reference for saving and loading a run and reading Game Data off each step, plus host events. The same shape on every Patterplay runtime.
sidebar:
  label: Save/load & Game Data
---

Once you can [advance a flow](/play/concepts/), this page covers **saving and loading** a run
and reading your own **Game Data** off each step (plus host events, which ride on Game Data). The calls
below are shown in JavaScript, but every engine exposes the same shape. Other runtime topics have their
own pages, [linked at the end](#more-runtime-topics).

**The same calls in your engine.** You only ship on one engine, so here is the local naming for the
operations you reach for most (see your engine's [quickstart](/play/overview/) for the rest):

| Operation | JavaScript | Unity (C#) | Unreal (C++) | Godot (GDScript) |
|---|---|---|---|---|
| Advance the flow | `flow.advance()` | `flow.Advance()` | `Flow->Advance()` | `flow.advance()` |
| Read a step's Game Data | `step.gameData` | `step.GameData` | `Step.GameData` | `step.get("gameData")` |
| Get / set a property | `flow.getProperty` / `setProperty` | `flow.GetProperty` / `SetProperty` | `Engine->GetPropertyNumber` / `SetPropertyNumber` | `flow.get_property` / `set_property` |
| Switch language live | `engine.setLocale("fr")` | `engine.SetLocale("fr")` | `Engine->Raw().setLocale("fr")` | `engine.set_locale("fr")` |

Save/load differs per engine (see each quickstart's *Save and load*).

## Save and load

One call snapshots the whole game; one restores it:

```ts
const save = engine.saveGame();   // a plain serialisable object (version 2)
// ...later...
engine.loadGame(save);
```

The snapshot holds everything needed to resume: shared state, world and per-flow visit
counts, selector cursors and shuffle bags, each flow's position and call/return stack,
the PRNG position, and any pending choice (saved as its exact option set and replayed
verbatim on load, so conditions aren't re-evaluated and the PRNG never double-draws).
**Locale is not in the save**: it's presentation, not game state. A saved position
that points at content you've since deleted resumes best-effort rather than throwing.

Each runtime round-trips **its own** save format, so saves are semantically equivalent
across engines, not byte-identical.

The **`@patterkit/play-helpers`** package wraps this for storage:

```ts
import { serializeState, deserializeState } from "@patterkit/play-helpers";

localStorage.setItem("save", serializeState(engine));   // → a JSON string in an envelope
deserializeState(engine, localStorage.getItem("save"));
```

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
  runtime.
- [The play-helpers package](/play/play-helpers/): optional save/load and property conveniences.
