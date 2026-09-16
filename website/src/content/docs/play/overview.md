---
title: Playing in your game
description: Pick the Patterplay runtime for your engine and see what all four of them give your game, from the play loop to live debugging.
sidebar:
  label: Overview
---

Your story reaches a player through a Patterplay runtime. You build the project to one
`.patterc` [bundle](/format/overview/), the runtime loads it, and it hands your game a flat
stream of beats (a line, a narration, a choice) that you render and drive however you like.

There's one runtime per engine, a set of four equals (JavaScript, Unity, Unreal, and Godot)
rather than approximations of each other. Every one is checked against the same
[test suite](/compatibility/), so the same story behaves identically everywhere, right down
to the seeded random draws. All four are shipping and verified today, so your engine is a
real, supported target rather than a roadmap item.

## Pick your engine

| Engine | Language | Get it | Guide |
|---|---|---|---|
| **JavaScript / Web** | TS/JS | `@patterkit/runtime` (npm) or a `patterplay.min.js` drop-in | [JavaScript & web](/play/javascript/) |
| **Unity** | C# | UPM package (git URL or Release tarball) | [Unity](/play/unity/) |
| **Unreal** | C++ / Blueprint | UE plugin | [Unreal](/play/unreal/) |
| **Godot** | GDScript | Addon | [Godot](/play/godot/) |

All four expose the same shape. You build an engine from a bundle, open a flow, advance it one
step at a time, present each step, and pass back the player's choice. Learn that shape once on
the [play loop](/play/concepts/) page and the per-engine guides are mostly install notes and
the local idiom.

If you would rather feel it before you read, open the interactive tour
(`examples/projects/tour.patter`) in Patterpad and **Play from Start**. It shows choices,
selectors, properties, conditions, and closed captions live.

## What every runtime gives you

The play loop is the same everywhere. You advance a flow, receive `line`, `text`, `gameEvent`,
`choice`, and `end` steps, and pick options. [The play loop](/play/concepts/) walks through it
once for all four engines, and [The Engine API](/play/engine/) is the deep reference for the
JavaScript one.

Properties are open to the host. You read and write the story's `@patter` and `@scene` state,
and you supply your game's own `@world` values.

[Host navigation](/play/navigation/) sends a running flow to any address when the *game*
decides where the story goes, or plays an address in one call for barks and one-liners.

Game Data and tags arrive on every step, your typed cues merged with their defaults and ready
to drive audio, animation, and quests. [Save/load & Game Data](/play/integration/) covers
reading them, and covers save and load, which is one call each way. The whole run (position,
state, visit counts, even the PRNG) serialises to a string and restores later.

[Localisation](/play/localisation/) works in both modes. Read resolved text in Embedded mode,
or take ids in IDs-only mode and feed them to your own system, and switch language live either
way.

[Closed captions](/play/closed-captions/) are a runtime toggle. Players can turn off the
non-spoken cues inside dialogue, and the runtime strips them while the line still fires so the
audio plays.

[Audio](/play/audio/) stays yours. Patter doesn't play audio. Every line carries a stable id
you tie voice-over to, your way. An optional resolver maps a beat to its winning take if you
use Audio Folders, and you still play it.

A live state inspector ships with every engine. Watch and edit a running engine's `@patter`
properties while you playtest, with type-aware editors and reset-to-default. It's an editor
window in Unity and Unreal, an in-game panel in Godot, and a drop-in DOM panel on the web. Like
the debug link, it's a dev tool that stays out of shipping builds.

[Live refresh & debug](/play/live-debug/) is a localhost link to Patterpad. Saving in the
editor pushes the new bundle into the running game without a restart (JavaScript today), and
the game streams its cursor back for the editor to follow like a debugger. Every engine ships a
client, and each is a dev-only tool that stays inert in a shipping build.

[Structure introspection](/play/structure/) walks the authored tree (scenes, blocks, snippets,
beats) without playing, for editor and dev tooling. `getOutline()` returns the nested tree, and
`getBeatSequence()` the flat, document-ordered beats.

## The guarantee

Every Patterplay runtime passes the same shared [test suite](/compatibility/), a fixed set
of cases covering expressions, full playthroughs, save/load round-trips, Game Data resolution,
and locale fallback. Each case is checked on every engine and on every release. That is what
lets you write the story once and trust it everywhere.
