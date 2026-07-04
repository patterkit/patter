# Patterplay API demo

The **shared demo flow** every Patterplay runtime plays, so the ports can be compared
side by side. It is deliberately small but exercises the core API: a spoken line (with a
resolved character name), a narrated text beat, a two-option choice, an effect that sets a
property, and `{@ref}` interpolation reading it back.

- [`story.ts`](./story.ts): the authored flow.
- [`demo.patterc`](./demo.patterc): the compiled bundle (regenerate with `npm run gen`).
- [`play.ts`](./play.ts): the **JavaScript** demo: loads the bundle and plays it through
  `@patterkit/runtime` + `@patterkit/play-helpers` (advance / choose / get+set property /
  save+load).

## Run the JS demo

```sh
node examples/demo/gen.mjs     # regenerate demo.patterc (+ the Unity sample copy)
node examples/demo/play.mjs    # play it
# or, from this folder: npm run demo
```

Expected output:

```
Guide: Welcome, traveller.
The road forks ahead.
  [0] Take the left path
  [1] Take the right path
> Take the left path
Guide: You find a pouch of 5 gold!
You walk on, 5 gold the richer.
[end]

@gold is now 5
```

## The other runtimes

The same `demo.patterc` is played by:

- **Unity**: `ports/unity/Patterplay/Samples~/PlayThrough` (the *Play-through demo* sample).
- **Unreal / Godot**: added with those ports.
