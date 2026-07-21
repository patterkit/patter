---
title: Playing in your game
description: Patterplay is the runtime family that plays a compiled Patter bundle, one native player per engine (JavaScript, Unity, Unreal, Godot), all verified against the same shared test suite. Pick your engine and go.
sidebar:
  label: The runtime family
---

**Patterplay** is how a compiled story reaches a player. You build your project to one
`.patterc` [bundle](/format/overview/), and a Patterplay runtime loads it and plays it:
handing your game a flat stream of beats (a line, a narration, a choice) that you render and
drive however you like.

There's **one runtime per engine** - a set of four equals (JS, Unity, Unreal, Godot), not
approximations of each other: every one is checked against the same
[test suite](/compatibility/), so the same story behaves identically everywhere, right
down to the seeded random draws. All four are shipping and verified **today**, so "your
engine" is a real, supported target, not a roadmap item.

## Pick your engine

| Engine | Language | Get it | Quickstart |
|---|---|---|---|
| **JavaScript / Web** | TS/JS | `@patterkit/runtime` (npm) or a `patterplay.min.js` drop-in | [JavaScript & web →](/play/javascript/) |
| **Unity** | C# | UPM package (git URL or Release tarball) | [Unity →](/play/unity/) |
| **Unreal** | C++ / Blueprint | UE plugin | [Unreal →](/play/unreal/) |
| **Godot** | GDScript | Addon | [Godot →](/play/godot/) |

All four expose the **same shape**: build an engine from a bundle, open a flow, advance it one
step at a time, present each step, and pass back the player's choice. Learn that shape once on
the [play loop](/play/concepts/) page and the per-engine quickstarts are mostly install
notes and the local idiom.

## What every runtime gives you

- **The play loop**: advance a flow, get `line` / `text` / `gameEvent` / `choice` / `end` steps,
  pick options. → [The play loop](/play/concepts/)
- **Properties**: read and write the story's `@patter` / `@scene` state; supply your game's
  `@world` values.
- **Host navigation**: send a running flow to any address when the *game* decides where the story
  goes, or play an address in one call for barks and one-liners. → [Host navigation](/play/navigation/)
- **Game Data & tags on every step**: your typed cues, merged with defaults, ready to drive
  audio, animation, and quests. → [Save/load & Game Data](/play/integration/)
- **Save / load**: serialise the whole run (position, state, visit counts, even the PRNG) and
  restore it later, in one call.
- **Localisation**: read resolved text in Embedded mode, or get ids in IDs-only mode and feed
  them to your own system; switch language live. → [Localisation](/play/localisation/)
- **Closed captions**: let players turn off the non-spoken cues inside dialogue; the runtime strips
  them while the line still fires so audio plays. → [Closed captions](/play/closed-captions/)
- **Audio**: Patter doesn't play audio - every line carries a stable id you tie voice-over to, your
  way. An optional resolver maps a beat to its winning take if you use Audio Folders; you still play
  it. → [Audio](/play/audio/)
- **A live state inspector**: watch and edit a running engine's `@patter` properties while you
  playtest, with type-aware editors and reset-to-default. Every engine ships one: an editor window
  in Unity and Unreal, an in-game panel in Godot, a drop-in DOM panel on the web. Like the debug
  link, it is a dev tool that stays out of shipping builds.
- **Live refresh & debug**: a localhost link to Patterpad. Saving in the editor pushes the new
  bundle into the running game without a restart (JavaScript today), and the game streams its
  cursor back for the editor to follow like a debugger. Every engine ships a client, and each is a
  dev-only tool that stays inert in a shipping build. → [Live refresh & debug](/play/live-debug/)
- **Structure introspection**: walk the authored tree (scenes → blocks → snippets → beats) without
  playing, for editor / dev tooling. `getOutline()` returns the nested tree; `getBeatSequence()` the
  flat, document-ordered beats. → [Structure introspection](/play/structure/)

## The guarantee

Every Patterplay runtime passes the same shared
[test suite](/compatibility/): a fixed set of cases covering expressions, full
playthroughs, save/load round-trips, Game Data resolution, and locale fallback. Each case is
checked on every engine and on every release. That's what lets you write the story once and
trust it everywhere.

## Where to go next

- **Just want it running?** Jump to your engine's quickstart above.
- **Want to feel it first?** Open the **interactive tour** (`examples/projects/tour.patter`) in Patterpad
  and **Play from Start**, it shows choices, selectors, properties, conditions, and closed captions live.
- **Want the mental model first?** Read [The play loop](/play/concepts/).
- **Need the deep JS API?** [The Engine API](/play/engine/).
- **Integrating save/load, Game Data, host events?** [Save/load & Game Data](/play/integration/).
