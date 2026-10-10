---
title: The Engine API
description: Play a compiled Patter bundle with the JavaScript runtime's Engine and Flow API.
sidebar:
  label: The Engine API
---

This is the **deep API reference** for the JavaScript reference engine, `@patterkit/runtime`.
If you just want it running, start with the [JavaScript & web guide](/play/javascript/);
for the cross-engine model, see [the play loop](/play/concepts/). The native
[Unity](/play/unity/), [Unreal](/play/unreal/), and [Godot](/play/godot/)
ports mirror this same shape.

## Engine and Flow

The **`Engine`** owns the world, meaning the bundle, shared global state, and every running
flow. A **`Flow`** is one independent position through the story, with its own cursor,
PRNG, and per-flow state. Many flows can run at once over the same data, sharing the
shared state; that's how you'd run two NPCs from one project. **One live instance, one
shared state**, and no whole-story copy per branch.

```ts
import { Engine } from "@patterkit/runtime";

const engine = new Engine(bundle);                     // bundle = parsed .patterc JSON
const flow = engine.openFlow("main", { scene: "square" });

for (;;) {
  const step = flow.advance();
  if (step.type === "line")   render(step.character, step.characterName, step.text);
  else if (step.type === "text")   narrate(step.text);
  else if (step.type === "gameEvent") host(step.gameData);   // your side-effects
  else if (step.type === "choice") flow.choose(pick(step.options).id);
  else if (step.type === "end")    break;
}
```

### Constructing the engine

```ts
new Engine(bundle, options?)
```

`options` (all optional): `seed` (the default per-flow PRNG seed), `locale` (the active
locale; defaults to the bundle's default), `replayPromptOnChoose` (speak a chosen option's
authored prompt back as its first beat, exactly as the choice showed it; a prompt the choice
borrowed from the option's own first line is not repeated, since that line plays anyway), and
`foreignScopes` (host-owned property scopes).
There's also an `rng` override, but for resumable, save-safe runs use the built-in
seeded PRNG.

### Opening a flow

```ts
engine.openFlow(id, { scene?, block?, seed? })
```

`scene` and `block` accept either a host-facing **gameId/address** or an internal id;
both default sensibly (first scene, first block). The block is **scene-scoped**, as for
`goto`: it must be in the scene you named. Re-opening an existing id replaces it. An
address that does not resolve throws before anything changes, so nothing opens and a flow
already open under that id carries on. Other engine methods: `getFlow(id)`, `flows()`, `closeFlow(id)`, and `reset()`
(drop all flows and re-seed shared state).

Dropping a flow **finishes** it: after `closeFlow(id)`, a `reset()`, or having its name
re-opened, a reference you are still holding is inert (advancing reports the end, `goto`
refuses to move it), so a forgotten reference cannot keep running scene entry effects
behind your back.

### Playing an address in one call

```ts
engine.runFlow(name, scene?, block?)      // -> the steps that played
```

Opens the named flow if it does not exist, moves it if it does, plays to the next stop,
and returns what played. Unlike `openFlow`, it **reuses** the named flow rather than
replacing it, so variation state (shuffles, once-each lists, visit counts) keeps its place
across calls. An empty array means the address had nothing left to give; an address that
does not resolve throws. See [Host navigation](/play/navigation/).

## Walking a flow

- **`flow.advance()`**: the next step (line, text, game event, choice, or end).
- **`flow.advanceToStop()`**: `{ played, stop }`, collecting beats until the next choice
  or the end (handy when you render a whole exchange at once).
- **`flow.getChoices()`**: the options of a pending choice.
- **`flow.choose(id)`**: pick an eligible option by id, and the next `advance()` runs it.
  It throws if there's no pending choice, or the id is unknown or ineligible.
- **`flow.isEnded()`, `flow.currentScene`**: state for tooling that follows the
  story across scenes.
- **`flow.reset(scene?, block?)`**: begin this flow again at a scene (the first one by default), forgetting
  everything that is its own: its position, its own properties, its visit counts, and anything waiting to be
  delivered. Shared state is kept. Every runtime calls it `reset` (`Reset` in C# and Blueprint).
- **`flow.goto(scene, block?)`**: returns a `boolean` and moves the cursor to an address, exactly as an
  authored jump would (on-entry effects run, arriving counts as a visit, the call stack is
  replaced). It moves rather than resets, so variation and visit counts carry on; it lands
  immediately, abandoning any part-delivered snippet or pending choice. It returns `false` and
  leaves the cursor alone if the address does not resolve; the block is scene-scoped. See
  [Host navigation](/play/navigation/).
- **`flow.isClosed`**: whether this flow has been finished (see above).

### Step shapes

| `step.type` | Fields |
| --- | --- |
| `"line"` | `id`, `text`, `character?`, `characterName?`, `direction?`, `qualifier?`, `qualifierName?`, `padAfter`, `gameData?`, `tags?` |
| `"text"` | `id`, `text`, `padAfter`, `gameData?`, `tags?` |
| `"gameEvent"` | `id`, `gameData?`, `tags?`: no text; the host-event beat |
| `"choice"` | `groupId`, `options: ChoiceOption[]` |
| `"end"` |: |

`text` is interpolated for you (against current property values), except on voiced
lines, which are static. `characterName` is the localised display name; if a character
has none, it's absent and you fall back to the `character` token. **`qualifier`** is the line's
[speaker qualifier](/setup/cast/#speaker-qualifiers), by its `gameId` (`"vo"`, `"os"`,
`"radio"`, or one of the project's own), and **`qualifierName`** is its shown name (`V.O.`),
localised as `characterName` is. Both are absent when the line has none. What a qualifier
means is your game's: play a `vo` line from a non-positional voice, say, or put a filter on a
`radio` one.

**`padAfter`** is the writer's pause after a line or text beat, in seconds, already resolved from the
beat's own value and the defaults above it (0.6 when nothing sets one). Negative means the next line cuts in
that long before this one ends; a snippet's last line, or a line followed by a game event, is never negative. When your game times lines itself,
these are the rules the writer expects: start the next line `padAfter` after this one ends (from the
start of a cut-in line, never before this line's own start); ignore the pause on the last line of a
conversation and on the line before a choice, where the player decides; count a pause after a game event
from when the event is done; and apply no pauses when the player clicks through. A **`ChoiceOption`**
is `{ id, prompt?, eligible, gameData? }`: ineligible options are still present (greyed)
unless they're secret; pass `id` to `choose()`. A choice is only offered when at least one option
can be taken: if every remaining option is greyed out, the choice runs dry, as one with no options
does, so its fallback plays if it has one and otherwise the flow moves on. **`tags`** is the beat's accumulated
author tags (its own plus every ancestor's), absent when empty: see
[Tags at runtime](/play/tags/).

## Properties

Read and write game state from the host:

```ts
engine.getProperty("@gold");          // shared @patter globals
engine.setProperty("@gold", 10);
flow.getProperty("@scene.locked");    // @scene props live on a flow
flow.setProperty("@scene.locked", false);
```

`@patter` globals are reachable from the engine; `@scene` properties (and per-flow
property values) are read and written on a `Flow`. The
[`@patterkit/play-helpers`](/play/integration/) package adds conveniences like
`setProperties(engine, { "@hp": 10 })`.

Visit counts, which a story reads with `visits()` and `seen()`, are there for a debug panel too:
`engine.getVisitCounts()` gives the counts shared across every flow and `flow.getVisitCounts()` a
flow's own, each by node id. Every runtime has the same call (`GetVisitCounts` in C# and Blueprint,
`get_visit_counts` in Godot).

## When content fails

A condition or effect can fail while the story plays, in ways the compiler can't see: a division by
zero, a value from your game of an unexpected type, or the story setting a `@world` value your game
marks read-only. The story never stops for one. A failing condition counts as false, so its line,
option, or branch is skipped, and a failing effect is skipped while the rest of its list still runs.
Every runtime does the same.

Each failure is reported, so it's never silent. Pass `onError` to hear about it: it receives the flow,
what failed (`condition`, `effect`, or `best-match`), the node, the expression's source, and the
error. With the decision log on, each is also a `diagnostic` entry in it.

```ts
const engine = new Engine(bundle, {
  onError: (e) => console.error(`${e.kind} on ${e.node}: ${e.message}`),
});
```

| Runtime | How to hear about it | Unset |
|---|---|---|
| JS | `onError` in the engine options | `console.warn` |
| Unity | `EngineOptions.OnError` (a `PlayError`) | `Debug.LogWarning` |
| Unreal | the engine's `OnError` event (an `FPatterPlayError`); `EngineOptions::onError` in C++ | a log warning |
| Godot | `"on_error"` in the options, a `Callable` taking a Dictionary | `push_warning` |

Patterpad's Play window marks each failure in its transcript, and the
[coverage test](/production/coverage-testing/) lists every one it saw.

## Why that line?

A step tells you what played, not why. The decision log records each decision the engine made and its
reasoning:

- each branch or sequence it chose from, with every option it looked at and why each was or wasn't
  taken;
- each choice it offered, with the options it greyed out, and the option chosen;
- each jump;
- each property it set, with the value it replaced;
- each content error it played through.

Turn it on with `log: true` in the engine options. `engine.log()` is the whole run in order, each entry
naming its flow and scene. A flow's own `log()` holds only that flow's decisions. `clearLog()` empties a
log, and entries keep counting from where they were, so two reads either side of a clear still agree on
the order.

For a tool that wants the decisions as they happen, `onTrace` hands each one over with the flow it
happened in, whether the log is on or off. It returns a function that stops it.

```ts
const stop = engine.onTrace((flow, entry) => console.log(flow, entry.type));
```

| Runtime | The log | Live |
|---|---|---|
| JS | `log` option; `engine.log()`, `flow.log()`, `clearLog()` | `engine.onTrace(handler)`, returning its stop |
| Unity | `EngineOptions.Log`; `Log()`, `ClearLog()` | `engine.OnTrace(handler)`, returning its stop |
| Unreal | `bLog` in `FPatterEngineOptions`; `Log()`, `ClearLog()` | the engine's `OnTrace` event; `Engine::onTrace` in C++ |
| Godot | `"log"` in the options; `log()`, `clear_log()` | `engine.on_trace(handler)`, returning its stop |

Without the log, and with nothing tracing, the engine does none of this work.

## Next

- [Integration](/play/integration/): save/load, Game Data, localisation at runtime, and helpers.
- [Playing in your game](/play/overview/): Unity, Unreal, Godot.
- [Compatibility](/compatibility/): the shared test suite that guarantees parity.
