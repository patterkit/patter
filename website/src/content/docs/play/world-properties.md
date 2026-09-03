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

Four things, and they are the same four in Storylet Studio, in the same order, so a game running
both engines sees one rule:

1. **Read-only is the story's promise, declared on the property** (`writable: false` in the
   project, the **Read-only** switch in Patterpad). A condition can still read `@world.alarm`;
   an effect that sets it is a **validation error**, so a scene cannot move the game's state by
   mistake.
2. **The runtime keeps the promise too.** If a bundle somehow carries such a write, the engine
   refuses it with `'alarm' is read-only` and nothing changes. Your resolver's `set` is never
   called for a read-only property.
3. **A resolver with no `set` makes the whole of `@world` read-only to the story**, whatever the
   declarations say. That is the game's policy rather than the story's promise; both apply.
4. **Your game is never bound, through its own resolver.** Bind one and the game moves `@world`
   whenever it likes, read-only or not. Bind none, and the engine's self-backed bag keeps the
   declaration for every caller: a read-only value then holds its default for the whole run. If
   the game must move it, bind a resolver.

There is no write-only: a declared property can always be read by the story. If the game holds a
value the story should not see, do not declare it.

## If you don't bind a resolver

Binding is optional. Omit `world` and the runtime **self-backs** `@world` from the declared defaults:
a live in-memory value per property, seeded from its default, that the story reads and writes for the
length of the run. That's what lets a story using `@world` play standalone, in the Play window, a
[playable HTML](/setup/building-and-shipping/#a-playable-html-to-send-anyone) export, or a quick
test, with no host wiring.

Either way the values never enter Patter's save: your game owns them, and you persist them however you
already do.

## The native ports

Every runtime takes a live host resolver, in its own idiom, and self-backs `@world` when you give it
none:

- **Unity**: `EngineOptions.HostScopes`, an `IHostScope` per token → [Unity](/play/unity/#your-games-state)
- **Unreal**: a `UPatterWorld` bound at `UPatterEngine::Create(Bundle, World)` → [Unreal](/play/unreal/#your-games-state)
- **Godot**: the `host_scopes` option, a `get` / `set` pair per token → [Godot](/play/godot/#your-games-state)

The rules are the same everywhere: `@world` is never in a Patter save, a `writable: false`
declaration is refused by the engine with the same sentence (`'@world.x' is read-only`), bound or
self-backed, and a per-name policy your game keeps on its own container is the container's to refuse.
