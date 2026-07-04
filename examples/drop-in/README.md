# Patterplay drop-in (`<script>`)

The smallest possible host: a compiled Patter bundle played on a plain HTML page
by the self-contained **`patterplay.min.js`** - no bundler, no module loader, no
dev server. This is the "Patterplay JS" drop-in distribution.

## Run it

**From the release zip** (this folder ships as `demos/drop-in/` inside
`patterplay-js-<version>.zip`): just open `index.html` in a browser. Everything it needs
sits beside it.

**From the PatterKit repo**:

```sh
npm run build -w @patterkit/runtime   # produces packages/runtime/dist/patterplay.min.js
node examples/drop-in/gen.mjs         # (re)generates bundle.js from the demo story
```

Then open [`index.html`](./index.html) directly in a browser. (`gen.mjs` resolves the
workspace packages from source via esbuild aliases, so it runs without an install step;
from inside this folder, `npm run gen` does the same thing.)

## How it works

```html
<script src="patterplay.min.js"></script>   <!-- exposes window.Patterplay -->
<script src="bundle.js"></script>           <!-- exposes window.PATTER_BUNDLE -->
<script>
  const { Engine } = window.Patterplay;
  const flow = new Engine(window.PATTER_BUNDLE).openFlow("main", { scene: "square" });
  let r = flow.advance();   // -> { type: "line" | "text" | "gameEvent" | "choice" | "end", ... }
  // ...render r, call flow.choose(id) at a choice, loop until type === "end".
</script>
```

`bundle.js` is the compiled bundle (the same artifact Patterpad's **Build Bundle**
writes as `<name>.patterc`) wrapped as `window.PATTER_BUNDLE`. In a real game you
would ship the `.patterc` and `fetch()` it instead.

Save / load here calls `engine.saveGame()` / `loadGame()` directly. The
[`@patterkit/play-helpers`](../../packages/play-helpers) companion wraps these (plus
runtime property setters, a state logger, the Patterpad Live Link client, and audio
resolution) for module hosts:

```js
import { serializeState, deserializeState } from "@patterkit/play-helpers";
localStorage.setItem("save", serializeState(engine));
deserializeState(engine, localStorage.getItem("save"));
```
