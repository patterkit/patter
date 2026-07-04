# @patterkit/play-helpers

Thin game-integration helpers around [@patterkit/runtime](../runtime)'s `Engine` -
the **Patterplay JS** companion. None are required to play a bundle; they smooth
the host wiring most games end up writing anyway. Mirrors the Storylets data-runtime
helpers.

```sh
npm install @patterkit/play-helpers
```

## Save / load

Wrap the engine's whole-game snapshot in a tagged, versioned envelope - drop it into
localStorage or a file, and a foreign blob throws instead of corrupting a run.

```ts
import { serializeState, deserializeState } from "@patterkit/play-helpers";

localStorage.setItem("slot1", serializeState(engine));
deserializeState(engine, localStorage.getItem("slot1")!);   // throws on a non-patter blob
```

`saveState` / `loadState` are the object-level variants (no JSON string).

## Runtime properties

Read / write `@patter` globals, `@scene` props, or a wired foreign scope at runtime -
e.g. the game pushing inventory into the dialogue.

```ts
import { setProperty, setProperties, getProperty } from "@patterkit/play-helpers";

setProperties(engine, { "@hp": 10, "@scene.locked": false });
getProperty(engine, "@hp");   // 10
```

(Localisation needs no helper: an **Embedded** bundle carries its strings - construct with
`{ locale }` or switch live via `engine.setLocale()`; an **IDs-only** bundle emits beat IDs
your game localises itself, re-interpolated with `flow.interpolate()`. See the
[Localisation guide](https://patterkit.dev/play/localisation/).)

## State logger

A debug companion that watches the mutable runtime state (`@patter` / `@scene` /
visit counts, shared + per-flow) and reports what changed between captures. `logStep`
traces each played step, including its `gameData` (the host-event channel).

```ts
import { createStateLogger } from "@patterkit/play-helpers";

const log = createStateLogger(engine, { label: "main" });
const step = flow.advance();
log.logStep(step);   // [main] line WATCHMAN: "..." gameData={...}
log.capture();       // [main] @patter.bell_tolls: 0 -> 1
```

`snapshotState(engine)` / `diffState(a, b)` are the underlying pure functions.

## Live Link (Patterpad debug + hot reload)

`createDebugLink` streams the running story's cursor to Patterpad over a localhost
WebSocket, so the editor follows the game like a debugger - and receives **live bundle
pushes** back when the author edits, for hot reload without restarting:

```ts
import { createDebugLink, applyLiveBundle } from "@patterkit/play-helpers";

let engine = new Engine(bundle);
const link = createDebugLink({
  build: bundle.content.hash,
  onBundle: (msg) => {
    ({ engine, bundle } = applyLiveBundle(engine, bundle, msg.data));
    link.setBuild(msg.build);   // re-hello under the new build id
    rerender();
  },
});
link.flowOpened("main");
// after each step: link.observe(flowId, sceneId, beatId, step.type)
```

`applyLiveBundle` picks the cheapest tier itself: same `structureHash` -> in-place
`replaceStrings` (`kind: "text"`, nothing lost); structural change -> `hotSwap` to a fresh
engine restored from the old one (`kind: "structure"`). Wire it behind a dev flag - it is
a development tool, not a shipping feature.

## Property inspector

`createPropertyInspector(engine)` builds a small DOM panel of the engine's `@patter`
properties with type-aware editors (toggle / number / text / enum / flags) and
reset-to-default - the JS equivalent of the Unity / Unreal / Godot runtime-state panels.
`refresh()` re-reads values; `destroy()` unhooks; `pollMs` auto-refreshes.

## Audio resolution

`createAudioResolver(manifestJson, basePath)` reads a `patteraudio.json` manifest (the
sidecar Patterpad's Build writes next to the audio root) and resolves a beat to its
**winning take**:

```ts
import { createAudioResolver } from "@patterkit/play-helpers";

const audio = createAudioResolver(await (await fetch("audio/patteraudio.json")).text(), "audio");
const src = audio.resolve(step.id);   // "audio/scratch/beat42.wav" | null
```

It resolves; **you** play (an `<audio>` element, your engine's mixer, anything).
