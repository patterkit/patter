---
title: The Engine API
description: Play a compiled Patter bundle with the JavaScript runtime, the Engine and Flow API.
sidebar:
  label: The Engine API
---

This is the **deep API reference** for the JavaScript reference engine, `@patterkit/runtime`.
If you just want it running, start with the [JavaScript & web quickstart](/play/javascript/);
for the cross-engine model, see [the play loop](/play/concepts/). The native
[Unity](/play/unity/), [Unreal](/play/unreal/), and [Godot](/play/godot/)
ports mirror this same shape.

## Engine and Flow

The **`Engine`** owns the world: the bundle, shared global state, and every running
flow. A **`Flow`** is one independent position through the story: its own cursor,
PRNG, and per-flow state. Many flows can run at once over the same data, sharing the
shared state; that's how you'd run two NPCs from one project. **One live instance, one
shared state**: there's no whole-story copy per branch.

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
locale; defaults to the bundle's default), `replayPromptOnChoose` (replay a chosen
option's prompt as its first beat), and `foreignScopes` (host-owned property scopes).
There's also an `rng` override, but for resumable, save-safe runs use the built-in
seeded PRNG.

### Opening a flow

```ts
engine.openFlow(id, { scene?, block?, seed? })
```

`scene` and `block` accept either a host-facing **gameId/address** or an internal id;
both default sensibly (first scene, first block). Re-opening an existing id replaces
it. Other engine methods: `getFlow(id)`, `flows()`, `closeFlow(id)`, and `reset()`
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

- **`flow.advance()`** → the next step (line, text, game event, choice, or end).
- **`flow.advanceToStop()`** → `{ played, stop }`: collects beats until the next choice
  or the end (handy when you render a whole exchange at once).
- **`flow.getChoices()`** → the options of a pending choice.
- **`flow.choose(id)`**: pick an eligible option by id; the next `advance()` runs it.
  (Throws if there's no pending choice, or the id is unknown or ineligible.)
- **`flow.isEnded()`**, **`flow.currentScene`**: state for tooling that follows the
  story across scenes.
- **`flow.reset(scene?, block?)`**: forget this flow's position, keep shared state.
- **`flow.goto(scene, block?)`** → `boolean`: move the cursor to an address, exactly as an
  authored jump would (on-entry effects run, arriving counts as a visit, the call stack is
  replaced). It moves rather than resets, so variation and visit counts carry on; it lands
  immediately, abandoning any part-delivered snippet or pending choice. Returns `false` and
  leaves the cursor alone if the address does not resolve; the block is scene-scoped. See
  [Host navigation](/play/navigation/).
- **`flow.isClosed`**: whether this flow has been finished (see above).

### Step shapes

| `step.type` | Fields |
| --- | --- |
| `"line"` | `id`, `text`, `character?`, `characterName?`, `direction?`, `gameData?`, `tags?` |
| `"text"` | `id`, `text`, `gameData?`, `tags?` |
| `"gameEvent"` | `id`, `gameData?`, `tags?`: no text; the host-event beat |
| `"choice"` | `groupId`, `options: ChoiceOption[]` |
| `"end"` |: |

`text` is interpolated for you (against current property values), except on voiced
lines, which are static. `characterName` is the localised display name; if a character
has none, it's absent and you fall back to the `character` token. A **`ChoiceOption`**
is `{ id, prompt?, eligible, gameData? }`: ineligible options are still present (greyed)
unless they're secret; pass `id` to `choose()`. **`tags`** is the beat's accumulated
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

## Next

- [Integration](/play/integration/): save/load, Game Data, localisation at runtime, and helpers.
- [Playing in your game](/play/overview/): Unity, Unreal, Godot.
- [Compatibility](/compatibility/): the shared test suite that guarantees parity.
