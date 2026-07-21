---
title: JavaScript & web
description: Play a Patter bundle on the web, a zero-build patterplay.min.js drop-in or the @patterkit/runtime npm package. Load the bundle, walk the flow, render beats, handle choices, and save to localStorage.
sidebar:
  label: JavaScript & web
---

The JavaScript runtime plays a `.patterc` [bundle](/format/overview/) in any browser or
Node app. Two ways in: a **zero-build drop-in** for a plain HTML page, or the
**`@patterkit/runtime`** npm package for a bundled app. Both expose the same
[play loop](/play/concepts/).

## Install

**Drop-in (no build step):**

```html
<script src="patterplay.min.js"></script>   <!-- exposes window.Patterplay -->
```

Grab `patterplay.min.js` from the [downloads page](/download/) or a CDN. It's a single
self-contained file: no module loader, no bundler. The same release also carries
**`patterplay-js-<version>.zip`** - the whole JS runtime as a plain download, symmetric with
the Unity / Unreal / Godot plugin zips: the drop-in, the module builds (for vendoring into
your own build), the changelog, and two bundled demos (a zero-build drop-in page and the
interactive Patter tour). No npm needed anywhere.

**npm (for an app you bundle):**

```sh
npm install @patterkit/runtime
```

```js
import { Engine } from "@patterkit/runtime";
```

## A complete drop-in player

This is a full, runnable HTML page: load a bundle, render each beat, handle choices, and
save/load to `localStorage`. (A working copy ships in
[`examples/drop-in/`](https://github.com/patterkit/patter/tree/main/examples/drop-in).)

```html
<div id="stage"></div>
<div id="controls"></div>
<button id="save">Save</button>
<button id="load">Load</button>

<script src="patterplay.min.js"></script>   <!-- window.Patterplay -->
<script src="bundle.js"></script>            <!-- your compiled story as window.PATTER_BUNDLE -->
<script>
  const { Engine } = window.Patterplay;
  const BUNDLE = window.PATTER_BUNDLE;
  const startScene = Object.keys(BUNDLE.scenes)[0];
  const stage = document.getElementById("stage");
  const controls = document.getElementById("controls");

  let engine, flow;

  function newGame() {
    engine = new Engine(BUNDLE);
    flow = engine.openFlow("main", { scene: startScene });
    stage.innerHTML = "";
    run();
  }

  // Advance until a choice or the end, rendering each beat.
  function run() {
    controls.innerHTML = "";
    for (;;) {
      const step = flow.advance();
      if (step.type === "line")   add(`${step.characterName ?? step.character ?? ""}: ${step.text}`);
      else if (step.type === "text")   add(step.text);
      else if (step.type === "gameEvent") doHostCue(step);          // your game's cue
      else if (step.type === "choice") return renderChoice(step);
      else if (step.type === "end")    return add("The End");
    }
  }

  function renderChoice(step) {
    for (const opt of step.options) {
      const b = document.createElement("button");
      b.textContent = opt.prompt?.text ?? "(continue)";
      b.disabled = !opt.eligible;                                // failed-condition options grey out
      b.onclick = () => { flow.choose(opt.id); run(); };
      controls.appendChild(b);
    }
  }

  const add = (t) => { const d = document.createElement("div"); d.textContent = t; stage.appendChild(d); };
  function doHostCue(step) { /* play step.gameData?.sfx, etc. */ }

  document.getElementById("save").onclick =
    () => localStorage.setItem("save", JSON.stringify(engine.saveGame()));
  document.getElementById("load").onclick = () => {
    const blob = localStorage.getItem("save");
    if (!blob) return;
    engine = new Engine(BUNDLE);
    engine.loadGame(JSON.parse(blob));
    flow = engine.getFlow("main");
    stage.innerHTML = ""; run();
  };

  newGame();
</script>
```

That's the whole integration: `engine.openFlow` to start, `flow.advance()` to pull the next
beat, `flow.choose(id)` on a pick, `engine.saveGame()` / `loadGame()` for persistence.

## Getting the bundle into the page

Build your story to a `.patterc` (Patterpad's **Publish Bundle**, or `patter export`). Because it's
plain JSON, load it however suits you: `fetch()` it, `import` it, or (as above) generate a tiny
`bundle.js` that sets `window.PATTER_BUNDLE`. The drop-in example includes a `gen.mjs` that does
the last.

## Helpers, state, and localisation

- **`@patterkit/play-helpers`** wraps the common chores: `serializeState` / `deserializeState`
  (exactly what `saveGame()` does), typed property setters, a state logger, a live state inspector
  (below), and the [live refresh & debug](/play/live-debug/) link, including
  `applyLiveBundle` so editor saves land in the running game. Optional, but it saves boilerplate.
  → [Save/load & Game Data](/play/integration/)
- **Read your Game Data and tags** off each step to drive audio and visuals; supply your `@world`
  values; emit host events. → [Save/load & Game Data](/play/integration/)
- **Localisation**: read resolved text in Embedded mode, or get ids in IDs-only mode and
  resolve them yourself; switch language live. → [Localisation](/play/localisation/)

## Live state inspector

`@patterkit/play-helpers` ships a drop-in **state inspector**: a small DOM panel that watches and edits a
running engine's `@patter` properties live, with type-aware editors (toggle / number / text / enum /
flags) and a reset-to-default on each row. It's the browser parity of Unity's Runtime State window and
Godot's `PatterStatePanel`; because the JS game runs in-process, you pass the engine directly instead of
going through a registry.

```ts
import { createPropertyInspector } from "@patterkit/play-helpers";

const inspector = createPropertyInspector(engine, { container: document.body });
// It refreshes a few times a second and never clobbers a field you're editing.
// inspector.destroy();   // remove the panel when you're done
```

Edits write through `engine.setProperty`, so a change takes effect on the next beat, handy for poking at
values while you playtest. Leave it out of your shipping build.

## Going deeper

This page gets you playing. For the full method-by-method reference: `advance`,
`advanceToStop`, `getChoices`, property access, multiple flows: see
[The Engine API](/play/engine/). To send a flow somewhere from the game (`goto`, and `runFlow`
for barks), see [Host navigation](/play/navigation/).
