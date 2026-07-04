---
title: Coverage testing
description: "Play your story through many times, automatically, to catch content players can never reach, choices that run dry, and branches gated on values only your game sets."
sidebar:
  label: Coverage testing
---

Playing walks *one* route at a time. **Coverage testing** walks thousands: it runs your story
through automatically, picking a random option at each choice, and counts how often every beat
is reached. It's the fast way to answer "does anything ever actually get here?" and to catch
dead content before a player does.

## Running the test

**Review ▸ Run Coverage Test…** opens a window that stays open while you edit, so you can act
on what it finds. Up top: **Runs**, **Max steps**, **Seed** (the same seed replays the same
run, for repeatable checks), and a **Start** scene. Press **Run test** for a per-scene table of
every line, narration, and game event beat with its **reached %** and hit count.

The story needs a **start point** for the test (and for **Play ▸ Play from Start**); if you
haven't set one, you'll be asked to pick a scene, saved to **Project Settings ▸ General ▸
Start**.

Click any row to jump the editor straight to that beat. The window can **pin** itself on top
(on by default) and keeps your last results for the session.

## What it flags

Beats that never come up are flagged two ways:

- **‼ (dead)**: nothing ever reaches it. Usually a branch that can't be taken, or a condition
  that's never true.
- **? (needs input)**: it turns on a value your game owns (`@world.*`) that nothing in the
  story sets, so the test can't reach it on its own. The row reads *gated on @x*; click that
  name to see everywhere `@x` is used. Add a [driver](#input-drivers) and the test can reach it.

### Choices that ran dry

If a choice ever ends up with **nothing the player can take and no fallback**, it silently
steps past itself at runtime rather than dead-ending the game. That is easy to author by
accident, so the test also **flags any choice it actually saw run dry**, with the run count and
a click-through to the choice. Give such a choice a fallback option, or one unconditional
option, to guarantee the player a way through. (Patterpad also warns about this statically, in
the [Problems panel](/patterpad/structure-and-branching/).)

## World Properties and input drivers

Some branches turn on values your **game** owns rather than the story, written as `@world.name`
and declared up front in **Project Settings ▸ World Properties**. Declaring them is part of
[setting up the project](/setup/properties-and-data/#world-values-your-game-owns); what
matters here is that a declared `@world` value gives the test a **default** to fall back on, and
a place to hang a driver.

### Input drivers

Since your game sets these while it runs, the coverage test can't know them, so a branch that
turns on `@world.alarm` reads as *needs input*. To exercise it, add a **coverage driver** in the
same tab: name a `@world` value and give the test a pool to draw from (once at the start, or
re-rolled at each choice). **Propose from story** fills these in for you by reading your
conditions (`@world.threat >= 50` becomes 49, 50, 51; a pick-list becomes its options), ready
for you to tweak.

## On the command line

The same coverage test runs headlessly as `patter coverage` (with `--fail-on-gap` for CI): see
the [CLI](/cli/) page.
