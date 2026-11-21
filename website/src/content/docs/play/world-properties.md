---
title: World Properties
description: Bind your game's live state into a story as @world properties that conditions read and effects can write back.
sidebar:
  label: World Properties
---

**World Properties** are the values your *game* owns and the story reads, referenced as `@world.*`
in conditions, effects, and interpolated text. They're how you make dialogue reactive to live game
state: a threat level, the player's class, whether the alarm is ringing.

You **declare** them in Patterpad (Project Settings ▸ World Properties, see
[Properties & game data](/setup/properties-and-data/#game-scopes-values-your-game-owns)), giving
each a name, type, default, and whether the story may write it. At runtime you **bind** a resolver
so the story reads, and if you allow it, writes your live state.

## Bind a world resolver (JavaScript)

Bind `world` in the engine's `hostScopes`, a `get` (and optional `set`) over your own state:

```ts
const engine = new Engine(bundle, {
  hostScopes: {
    world: {
      get: (name) => game.world[name],                     // the story reads your live game state...
      set: (name, value) => { game.world[name] = value; }, // ...and can write it back
    },
  },
});
```

Now a condition on `@world.alarm` reads your live `game.world.alarm`, and an effect that sets
`@world.reputation` writes straight into your system, so the next line reacts and your game sees the
change. Everything under `@world` goes through this one resolver. `hostScopes` is keyed by scope
because every runtime takes the same option, but a Patter project declares the one scope, `world`.

A scope's token is case-sensitive: binding `World` doesn't bind `world`, so the engine reports it to
`onError` as a `setup` problem, naming the spelling the bundle declares, and self-backs `world` as if you
had bound nothing. Earlier releases also took the resolver as a `world` option of its own; it went in
1.0, and passing it is reported the same way.

A value your game writes with `setProperty` must fit the property's declaration: a boolean for a
boolean, one of an enum's values, one of a quality's stages, and so on. One that doesn't, or a name the
project doesn't declare under `@world`, throws and changes nothing, with a message saying what the
property takes.

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
3. **Your game is never bound by it.** The value is yours: `setProperty` writes a read-only
   `@world` property from your code, your tooling and Patterpad's coverage drivers alike, whether
   you bound a resolver or left the property self-backed. The flag says what the STORY may do, not
   what you may do. (Before September 2026 the runtime refused every caller, so a game could not
   advance its own clock through the engine.)
4. **A resolver with no `set` makes the whole of `@world` read-only to everyone**, whatever the
   declarations say, because there's nowhere for a write to land. That is the game's own doing rather
   than the story's promise.

There is no write-only: a declared property can always be read by the story. If the game holds a
value the story should not see, do not declare it.

A third kind of read-only belongs to your own container, not to Patter: a game that keeps its own
`@world` object (Unreal's `UPatterWorld` and its kin) can refuse a name to the story there too.
Three rules, and each one says whose it is.

## If you don't bind a resolver

Binding is optional. Leave `world` unbound and the runtime **self-backs** `@world` from the declared defaults:
a live in-memory value per property, seeded from its default, that the story reads and writes for the
length of the run. That's what lets a story using `@world` play standalone, in the Play window, a
[playable HTML](/setup/building-and-shipping/#a-playable-html-to-send-anyone) export, or a quick
test, with no host wiring.

A self-backed `@world` is a property like any other, so it is saved with the game. Only values your
game keeps and lends through a resolver stay out of the save, because your game persists those itself.

In a game that runs more than one engine, or that hands Patter a registry of its own, register
`@world` once in that registry instead, and give no engine a resolver. Register it owned when the
registry should store and save it, or foreign, with a resolver, when your game keeps the values.
[One registry per game](/play/integration/#one-registry-per-game) has the pattern.

## The native ports

On Unity, Unreal, and Godot you can bind `@world` in the editor, with no code to bind it: add a
**Patter World** to your scene, point the component that builds your engine at it, and have your game
write its state into it. It's the same binding as the code route below, under the token `world`, so
the same rules apply.

| Engine | In the editor | In code |
|---|---|---|
| Unity | a **Patter World** component (`PatterWorld`, or any component implementing `IHostScope`) in the **World** field of the Patter Runner Behaviour | `Bundle.CreateEngineWithWorld(world)`, or `EngineOptions.HostScopes` |
| Unreal | a **Patter World** component (`UPatterWorldComponent`) on the actor in the **World** field of the Patter Runner (or that your engine's component points at) | `UPatterEngine::CreateWithWorld(Bundle, World)`, or the host-scopes map at `UPatterEngine::Create` |
| Godot | a **PatterWorld** node in the **World** field of the `PatterRunner` | `{"host_scopes": {"world": $PatterWorld}}`, or a `get` / `set` pair |

Each engine page has the detail: [Unity](/play/unity/#your-games-state),
[Unreal](/play/unreal/#your-games-state), and [Godot](/play/godot/#your-games-state).

**Watch for an empty World.** Nothing bound is allowed, and the engine self-backs `@world` from the
declared defaults (above), but in a game that's usually a mistake: "if the player has the key" reads
the default and never sees your game. Each engine's runner warns once when the story reads `@world` and its
World field is empty, and each runtime's bundle says whether the story reads `@world` at all
(`DeclaresWorld`, `declares_world`) for a component of your own to do the same.

**A name you haven't set reads its declared default.** A bound World, Patter World included, holds only
what your game has put in it, so until your game sets a name the story reads the default the project
declares for it (its own default, else its type's: false, 0, an empty string, no flags, an enum's first
value, a quality's first stage). Reading a default writes nothing: the World holds only what your game or the story has set.

Every runtime takes the same host scopes in code, in its own idiom, and self-backs `@world` when you
bind none:

- **Unity** takes `EngineOptions.HostScopes`, an `IHostScope` per token.
- **Unreal** takes a host-scopes map at `UPatterEngine::Create(Bundle, HostScopes)`, a `UPatterWorld` per token.
- **Godot** uses the `host_scopes` option, a `PatterWorld` (or any object with `get_property` / `set_property` methods) or a `get` / `set` pair per token.

The rules are the same everywhere: a bound `@world` is never in a save, a self-backed one is; a `writable: false`
declaration refuses the STORY's write with the same sentence (`'@world.x' is read-only`), bound or
self-backed, while the game's own `setProperty` writes it; and a per-name policy your game keeps on
its own container is the container's to refuse.
