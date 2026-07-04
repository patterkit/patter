# Web tour demo

Plays **the interactive tour** (`examples/projects/tour.patter`) in a browser: the same demo
every engine port ships (Unity's `Samples~/TourDemo`, Godot's `addons/patterplay/demo`, Unreal's
`PatterplayDemo` sample project). Step the story, take the choices, and (when an audio folder is served)
each line fires its **winning take** through the `patteraudio.json` resolver
(`createAudioResolver` from `@patterkit/play-helpers`). The manifest picks the highest rung per
beat, so the demo plays whatever the tour's audio export currently holds; no rung is hard-coded
here.

## From the release zip

This folder ships prebuilt and self-contained as `demos/tour-web/` inside
**`patterplay-js-<version>.zip`** (on each `play-js-v*` GitHub Release) - `index.html`,
`dist/tour.js`, `assets/tour.patterc`, and this server:

```sh
node serve.mjs     # http://localhost:8093/
```

The zip ships **without audio files** (how you load and play audio is your platform call), so the
tour plays silently; the resolver wiring is all still there. To hear it, drop a Patter audio
folder (`patteraudio.json` + takes) at `assets/audio/`.

## From the PatterKit repo

```sh
node build.mjs     # bundle tour.ts -> dist/tour.js (esbuild, straight from workspace source)
node serve.mjs     # http://localhost:8093/
```

In the repo there is no local `assets/` folder, so the server maps `/assets/tour.patterc` and
`/assets/audio/*` straight onto the shared files in `examples/projects/`; nothing is copied, and
the tour plays its current takes (Patterpad **scratch** placeholders today - the moment better
takes land in the audio folder and the manifest is re-exported, the demo plays those instead,
untouched).

In your own game you'd deploy the audio folder next to your bundle and point the resolver's base
path at it; the runtime resolves, **you** play (here, one `<audio>` element).
