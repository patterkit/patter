# Patter Player

A tiny, framework-free **browser player for compiled Patter bundles** - a
game-agnostic test app to play any compiled `.patterc` bundle through `@patterkit/runtime`.

It renders each step the engine yields: spoken **lines** (speaker + text), prose
**text** beats, **game event** beats (shows their `gameData`, where host events ride
now), and **choices** (buttons, ineligible ones greyed). Inline `{@ref}`
interpolation is resolved live against runtime state.

## Run it

```
npm run build        # bundles player.ts + the runtime into dist/player.js (esbuild)
node serve.mjs 8091  # then open http://localhost:8091/
```

(The bundle is a self-contained IIFE, so you can also just open `index.html`
directly once built.)

- **Play sample** - compiles a built-in vignette (*The Curfew Bell*) *in the
  browser* and plays it. It's built to show off the flow model: **block-as-a-run**
  (blocks play their snippets in order), a **call-return tunnel** (a shared "bell"
  block called from two places, returning each time - watch the toll # to see the
  return), **jumps** and a hub **loop**, **gather** (a choice option runs its line
  then continues), a **conditional run-group**, plus `set` effects and `{@…}`
  interpolation.
- **Load .patterc** - play any bundle produced by `patter export` (or any
  `exportBundle` output). A `.patterc` is JSON, so the picker also accepts `.json`.
- **Save / Load** - snapshot the live flow (`engine.saveGame()`) to the browser
  and restore it (`loadGame()`), resuming at the exact cursor - even after a page
  reload (the bundle is stored alongside the snapshot).

## How it works

`player.ts` constructs `new Engine(bundle)` and loops on `advance()`, rendering
each `StepResult`; choice buttons call `flow.choose(id)`. That's the entire
host contract - the same surface a real game integrates against. The build aliases
the `@patterkit/*` workspace packages to their TS source, so no pre-build of the
library packages is needed.
