---
title: World Properties
description: "Bind your game's live state into a Patter story as @world properties: the story reads them in conditions, effects can write them back, all through a single world resolver."
sidebar:
  label: World Properties
---

**World Properties** are the values your *game* owns and the story reads, referenced as `@world.*`
in conditions, effects, and interpolated text. They're how you make dialogue reactive to live game
state: a threat level, the player's class, whether the alarm is ringing.

You **declare** them in Patterpad (Project Settings ▸ World Properties, see
[Properties & game data](/setup/properties-and-data/#world-values-your-game-owns)), giving
each a name, type, default, and whether the story may write it. At runtime you **bind** one resolver
so the story reads, and if you allow it, writes your live state.

## Bind a world resolver (JavaScript)

Pass a single `world` resolver to the `Engine`, a `get` (and optional `set`) over your own state:

```ts
const engine = new Engine(bundle, {
  world: {
    get: (name) => game.world[name],                     // the story reads your live game state...
    set: (name, value) => { game.world[name] = value; }, // ...and can write it back
  },
});
```

Now a condition on `@world.alarm` reads your live `game.world.alarm`, and an effect that sets
`@world.reputation` writes straight into your system, so the next line reacts and your game sees the
change. Everything under `@world` goes through this one resolver: there's a single World Properties
scope, not a set of arbitrary host scopes to register.

## Read-only properties

Whether the story may write a given `@world` value is fixed when you declare it (the **Read-only**
switch in Patterpad). A read-only property can be read in a condition, but an effect that tries to set
it is a validation error. That comes from the property's declaration in the bundle, so it holds
whether or not your resolver provides a `set`.

## If you don't bind a resolver

Binding is optional. Omit `world` and the runtime **self-backs** `@world` from the declared defaults:
a live in-memory value per property, seeded from its default, that the story reads and writes for the
length of the run. That's what lets a story using `@world` play standalone, in the Play window, a
[playable HTML](/setup/building-and-shipping/#a-playable-html-to-send-anyone) export, or a quick
test, with no host wiring.

Either way the values never enter Patter's save: your game owns them, and you persist them however you
already do.

## The native ports

Wiring a live host resolver is a JavaScript-runtime feature today. The Unity, Unreal, and Godot
runtimes resolve `@world` from its declared defaults (the self-backed path above); a live resolver in
those engines is on the roadmap. See [Compatibility](/compatibility/).
