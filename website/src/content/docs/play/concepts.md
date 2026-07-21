---
title: The play loop
description: The model every Patterplay runtime shares, build an engine from a bundle, open a flow, advance it one step at a time, render line/text/gameEvent/choice/end steps, and pass back the player's choice.
sidebar:
  label: The play loop
---

Every Patterplay runtime (JavaScript, Unity, Unreal, Godot) works the same way. Learn the
shape here once; each engine's [quickstart](/play/overview/) is then mostly install notes
and local naming.

## Engine and flow

- An **Engine** is built from a loaded [bundle](/format/overview/). It holds the shared
  story state (your `@patter` and `@scene` properties, visit counts) and it's what you
  save and load.
- A **Flow** is one position cursor walking through the story. You open a flow at a starting
  address (a scene, optionally a block); most games run one flow, but you can run several (a
  main thread plus a side conversation) off the same engine. Usually the writing decides where
  the cursor goes next, but the game can move it to any address too:
  [Host navigation](/play/navigation/).

```
engine = Engine(bundle)              // shared state
flow   = engine.openFlow("main", scene)   // a cursor at a starting point
```

The method names differ slightly per engine (`openFlow` / `OpenFlow` / `open_flow`) but the
idea is identical.

## Advancing, one step at a time

<svg viewBox="0 0 760 268" role="img" aria-labelledby="pk-loop-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-loop-title">Your game owns the loop: it calls advance() (or choose(id) on a choice), the flow returns one step (line, text, gameEvent, choice, or end), and the game renders it. The game also reads and writes story state with getProperty and setProperty and supplies its own values as @world.</title>
  <defs>
    <marker id="pk-loop-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker>
  </defs>
  <!-- host + flow boxes -->
  <rect x="24" y="42" width="200" height="96" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <rect x="24" y="42" width="200" height="3" rx="1.5" fill="var(--pt-ember,#d2603e)"/>
  <text x="124" y="82" text-anchor="middle" fill="var(--sl-color-white)" font-size="14">Your game</text>
  <text x="124" y="102" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11">the host, owns the loop</text>
  <rect x="536" y="42" width="200" height="96" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <rect x="536" y="42" width="200" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="636" y="82" text-anchor="middle" fill="var(--sl-color-white)" font-size="14">Flow</text>
  <text x="636" y="102" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11">one run of the story</text>
  <!-- top arrow host -> flow -->
  <text x="380" y="60" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="12">advance()  /  choose(id)</text>
  <path d="M228 74 H532" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-loop-arrow)"/>
  <!-- return arrow flow -> host -->
  <text x="380" y="112" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">returns one step, one of:</text>
  <path d="M532 126 H228" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-loop-arrow)"/>
  <!-- five step chips -->
  <g font-size="12" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)">
    <rect x="233" y="150" width="46" height="28" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="256" y="169">line</text>
    <rect x="289" y="150" width="46" height="28" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="312" y="169">text</text>
    <rect x="345" y="150" width="80" height="28" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="385" y="169">gameEvent</text>
    <rect x="435" y="150" width="58" height="28" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="464" y="169">choice</text>
    <rect x="503" y="150" width="42" height="28" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="524" y="169">end</text>
  </g>
  <!-- state note -->
  <rect x="24" y="214" width="712" height="40" rx="8" fill="none" stroke="var(--sl-color-gray-5)" stroke-dasharray="4 4"/>
  <text x="380" y="238" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">The host also reads and writes story state with getProperty / setProperty, and supplies its own live values to the story as @world.</text>
</svg>

You drive the flow by asking for the next **step** and rendering it. A step is one of five
kinds:

| Step | Meaning | What it carries |
|---|---|---|
| **line** | A character speaks | the speaker, the (localised) display name, the text, direction, Game Data, tags |
| **text** | Narration the player reads | the text, Game Data, tags |
| **gameEvent** | A host-facing cue, no spoken text | an id + Game Data (play a sound, move the camera) |
| **choice** | The player must pick | a list of options (each with prompt text + an `eligible` flag) |
| **end** | The flow finished |: |

A minimal loop: advance until a choice or the end, rendering each beat as it comes.

```
loop:
    step = flow.advance()
    switch step.type:
        "line":   show(step.characterName ?? step.character, step.text)
        "text":   show(step.text)
        "gameEvent": doHostCue(step.id, step.gameData)
        "choice": presentOptions(step.options); break   // wait for the player
        "end":    finish(); break
```

When the player picks, call `choose` with the option's id, then resume advancing:

```
flow.choose(optionId)
// ...back to the loop
```

Options that fail their condition come back **ineligible** rather than missing (so you can grey
them out), unless the author marked them to hide entirely. That `eligible` flag is yours to
render however suits your UI.

## Reading and writing state

The engine exposes the story's properties by reference:

```
engine.getProperty("@gold")        // read @patter / @scene state
engine.setProperty("@gold", 10)    // write it (e.g. from a shop your game runs)
```

Your game also **supplies** the `@world` values the story reads (threat level, location). If you
don't bind one, the runtime falls back to the value the project declared as its default. The
details (including reading typed **Game Data** and **tags** off each step) are in
[Save/load & Game Data](/play/integration/).

## Save and load

The whole run: every flow's position, the shared state, visit counts, even the seeded random
generator's place in its sequence: serialises in one call and restores in one call.
Every runtime handles save/load the same way, so a save made by one engine round-trips
exactly. See your engine's quickstart for the local call and
[Save/load & Game Data](/play/integration/) for the shape.

## Localisation

In **Embedded** mode the text on each step is already resolved to the current language, and you
can switch language live. In **IDs-only** mode the step carries ids instead of text, and you
resolve them through your own localisation system. The runtime API is the same either way; only
where the words come from changes. → [Localisation](/play/localisation/)

## Next

- Get it running on your engine: [JavaScript](/play/javascript/) ·
  [Unity](/play/unity/) · [Unreal](/play/unreal/) · [Godot](/play/godot/).
- The deep JavaScript API: [The Engine API](/play/engine/).
- Moving a flow from the game: [Host navigation](/play/navigation/).
- Save/load, Game Data, tags, host events: [Save/load & Game Data](/play/integration/).
