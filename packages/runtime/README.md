# @patterkit/runtime

**Patterplay JS** - play [Patter](https://patterkit.dev/) branching
dialogue in JavaScript or TypeScript. Load a compiled bundle (a `.patterc`, the
artifact Patterpad's *Build Bundle* writes) and play the dialogue: flows, selectors,
choices, jumps, effects, properties, save/load. One of the four Patterplay runtimes
(JS, Unity, Unreal, Godot): every runtime plays the same bundle with the same
behaviour, and the whole set is **versioned in lockstep** (see
[CHANGELOG.md](CHANGELOG.md)).

## Get it

Three equivalent channels - pick whichever fits how you work; **no npm is required**:

- **Release zip**: `patterplay-js-<version>.zip` on every
  [`play-js-v*` GitHub Release](https://github.com/patterkit/patter/releases) - this
  runtime as a plain download, symmetric with the Unity / Unreal / Godot plugin zips.
  It carries `patterplay.min.js` (the `<script>` drop-in), the module builds under
  `dist/` (ESM + CJS + types, for vendoring into your own build), this README, the
  CHANGELOG, and two `demos/` (the zero-build drop-in page and the interactive tour).
- **npm**: `npm install @patterkit/runtime` (same version as the zip).
- **CDN**: `patterplay.min.js` via unpkg/jsDelivr, or loose on the same Release.

## Use it (npm / bundler)

```ts
import { Engine } from "@patterkit/runtime";

const engine = new Engine(bundle);                       // bundle = parsed .patterc JSON
const flow = engine.openFlow("main", { scene: "square" });

for (;;) {
  const step = flow.advance();
  if (step.type === "line") console.log(`${step.characterName ?? step.character}: ${step.text}`);
  else if (step.type === "text") console.log(step.text);
  else if (step.type === "choice") { flow.choose(step.options.find((o) => o.eligible)!.id); }
  else if (step.type === "end") break;
}
```

`new Engine(bundle, options)` takes `{ rng?, seed?, locale?, world?, replayPromptOnChoose?, closedCaptions? }`:
- `world` is the host's resolver for `@world` properties (World Properties): `{ get(name), set?(name, value) }`.
  Omit it and the runtime self-backs `@world` from the declared defaults.
- `locale` plays a non-default language (embedded localisation; an IDs-only bundle ignores it).
- A string the active locale is missing falls back to the default-locale source,
  flagged `<Untranslated: {id}> {source}` so a partial translation is impossible to miss.

Switch language mid-game with **`engine.setLocale("fr")`** (read it back via `engine.locale`):
subsequent beats / character names / `{@ref}` render in the new locale while the flow's position,
state, visit counts, and PRNG are untouched - so a game's "language" setting can change live without
rebuilding the engine or losing the player's place.

The above is the **Embedded** build (strings ship inside the `.patterc`). An **IDs-only** build ships no
strings: `step.text` is the beat **ID** and `step.characterName` is omitted - your game localises the IDs in
its own system, then applies `{@ref}` replacement with **`flow.interpolate(yourString)`**. See the
[Localisation guide](https://patterkit.dev/play/localisation/) for both modes across all four runtimes.

## Drop-in (`<script>`)

`patterplay.min.js` is a single self-contained, minified IIFE - every dependency
inlined - for plain HTML pages with no bundler:

```html
<script src="https://unpkg.com/@patterkit/runtime/dist/patterplay.min.js"></script>
<script>
  const { Engine } = window.Patterplay;     // also: Flow, gameDataFields, gameDataValue, effectiveGameData
  const flow = new Engine(BUNDLE).openFlow("main", { scene: "square" });
  // ...advance() / choose() exactly as above.
</script>
```

Build it locally with `npm run build -w @patterkit/runtime` (emits
`dist/patterplay.min.js`).

## Demos

The release zip's `demos/` folder holds two working references (in the repo:
[examples/drop-in](../../examples/drop-in) and [examples/tour-web](../../examples/tour-web)):

- **drop-in** - the smallest possible host: a plain HTML page playing a compiled bundle
  via `patterplay.min.js`. Open `index.html` straight from the unzipped folder.
- **tour-web** - the full interactive Patter tour in a browser (`node serve.mjs`, open
  the page). The JS counterpart of the demos the Unity, Godot, and Unreal plugins bundle
  (audio-less: the resolver wiring is there, playback is your call).

## Save / load

`engine.saveGame()` returns a JSON-serialisable snapshot of the whole game (shared
state, visit counts, every live flow); `engine.loadGame(blob)` restores it.
[@patterkit/play-helpers](../play-helpers) wraps these as `serializeState` /
`deserializeState` with a tagged envelope.
