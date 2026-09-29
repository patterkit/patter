---
title: Coverage testing
description: Play your story through many times automatically to catch content players can never reach and choices that run dry.
sidebar:
  label: Coverage testing
---

Playing walks *one* route at a time. **Coverage testing** walks thousands: it runs your story
through automatically, picking a random option at each choice, and counts how often every beat
is reached. It's the fast way to answer "does anything ever actually get here?" and to catch
dead content before a player does.

## Running the test

**Review ▸ Coverage Test…** (`Shift+Cmd+C`) opens a window that stays open while you edit, so you can act
on what it finds. Up top: **Runs**, **Max steps**, **Seed** (the same seed replays the same
run, for repeatable checks), and a **Start** scene. Press **Run test** for a table of every
line, narration, and game event beat, showing how often each one came up.

The story needs a **start point** for the test (and for **Play ▸ Play from Start**); if you
haven't set one, you'll be asked to pick a scene, saved to **Project Settings ▸ General ▸
Start**.

Click any row to jump the editor straight to that beat. The window can **pin** itself on top
(on by default) and keeps your last results for the session.

## Reading the results

<figure class="doc-shot">
  <img src="/doc-images/Coverage.png" alt="The Coverage window after 5,000 runs of the interactive tour: Runs, Max steps, Seed and Start boxes with a Run test button; headline figures of 100% beats reached, 60 of 60 covered, 0 never reached and 0 rarely reached; a line reading 4,704 reached the end, 0 stalled at a choice, 296 hit the step limit; a switch set to Least reached first; and a table with Runs reached and Times played columns, led by Darkness at 9% and a card turns over at 16 to 17%." />
  <figcaption>The Coverage window after 5,000 runs of the tour. Everything is reached, so the table leads with the least-reached beats: a branch's fallback at 9%, and each tarot card at around 16%, which is by design, since the test draws one card of several at random.</figcaption>
</figure>

**The four numbers at the top.** **Beats reached** is the share of all your beats that played at
least once, and **Covered** is the same as a count. **Never reached** counts the beats no run ever
played, and **Rarely reached** the beats that did play, but in fewer than 5% of runs.

**How the runs ended.** Under the numbers, one line says how many runs **reached the end**, how
many **stalled at a choice** with nothing to pick, and how many **hit the step limit** (still going
at **Max steps**, usually because the test kept wandering round a hub the player can return to).
Runs that hit the step limit aren't a fault in themselves; a story with a loop always has some.

**The table.** Each row is one beat: its kind, who says it, and the start of the line. Two
numbers follow:

- **Runs reached** is the share of runs that played the beat at least once.
- **Times played** is how often it played across all the runs together. It can be more than the
  number of runs, because a beat can play again in the same run, like a hub's "back where we
  started" line.

**Least reached first, or script order.** The table opens **least reached first**: the beats that
never came up at the top, then the rarest, down to the ones every run plays. That puts the rows
worth a look where you see them first. Switch to **Script order** for every beat in the order the
script runs, scene by scene. The window remembers which you picked.

The test chooses at random, so how often a beat comes up isn't how often a player will see it:
real players choose on purpose. Read the numbers as "can this happen, and how easily", not as a
forecast.

## What it flags

Beats that never come up are flagged two ways.

A beat marked **‼ (dead)** is one nothing ever reaches. Usually that's a branch that can't be
taken, or a condition that's never true.

A beat marked **? (needs input)** turns on a value your game owns (`@world.*`) that nothing in the
story sets, so the test can't reach it on its own. The row reads *gated on @x*; click that name to
see everywhere `@x` is used. Add a [driver](#input-drivers) and the test can reach it.

A beat marked **? (dead at one remove)** is gated on a value your story *does* set, but only on a
beat that never played either. The row names the gate and the beat that would have to happen first,
so two mysteries become one. Open that beat and ask why *it* never came up. A gate on a single flag
is named as the flag (`@world.mood:armed`), not the whole property, because a property half the
story writes always looks well fed.

That last one is deliberately cautious. Where the test can't be sure a writer never ran (the effect
sits on a beat-less snippet, or the property is assigned wholesale rather than a flag at a time), it
says nothing at all rather than guess. A wrong *"this can never happen"* is worse than silence.

### Rarely reached

A beat tagged **Rare** did play, but in fewer than 5% of runs. It can happen, just not easily:
usually it sits behind an unlikely run of choices, or a condition that's nearly always false. That
can be exactly what you meant, like one card of many drawn at random, or a secret. It's worth a
look when it isn't: a line most players should see that hides behind a condition you thought was
common.

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

Where the game [shares its scopes](/setup/properties-and-data/#sharing-scopes-with-the-games-other-tools),
the test also stands in the other editing tools' scopes a line names, such as the Storylet
Engine's `@story`, from the defaults their files declare, so a story that reads them runs rather
than being refused.

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
