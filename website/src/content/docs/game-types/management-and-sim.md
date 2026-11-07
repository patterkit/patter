---
title: Management and sim games
description: See how Patter slots into a management or sim game, playing the advisers and decision scenes while the simulation and Storylet Studio decide what happens.
sidebar:
  label: Management and sim
---

How Patter slots into a management or sim game.

In a management or sim game the simulation is the game, and the story comes from it: a strike at the mill, an
adviser with a warning, a decision to make. Your game runs the simulation. Storylet Studio is the natural tool
for deciding which event happens, and Patter plays the conversations and decisions that go with each one.

## Advisers who read the numbers

Report the simulation's values as [`@world` properties](/play/world-properties/), such as funds, unrest, and
the harvest, and an adviser's lines follow them.
[Best match](/format/choices-and-logic/#best-match-lines-that-fit-the-moment) picks the most pressing thing to
mention, with a plain line when all's well.

```
(Best match)
(if @world.unrest > 70 and @world.funds < 100)
ADVISER: The people are angry, and we can't pay the guard.
(if @world.unrest > 70)
ADVISER: There's talk of trouble in the lower town.
ADVISER: All quiet, my lord.
```

Mark these properties read-only to the story, so a scene can read the simulation but never change it by mistake.

## Decisions that feed back

A decision is a [`choice`](/format/choices-and-logic/#choices-and-options). When the player picks, your game
needs to know what was decided, and does the rest itself. Put the decision's id in the option's
[Game Data](/format/gamedata-and-addressing/), such as `decision: "raise_wages"`, and your simulation applies it.
The dialogue says what the player chose. What raising wages does to the economy is your game's.

## Values in the text

Text and options can show a live value with `{@world.funds}`
([Embedding property values](/format/choices-and-logic/#embedding-property-values-in-text)), so a report can
say how much is in the treasury. In a voiced project that works in text and options but not in spoken lines,
since a recording can't change.

## What stays in your game

- The simulation, and what each decision does to it.
- When an event is due, and the interface that shows it.

## Where Storylet Studio fits

It leads. Which event fires this month depends on the state of the simulation, and that's a pool of beats with
conditions, dealt as the world changes. Its **News**, **Job board**, and **Story acts** kits are good starting
points ([box kits](https://storylets.dev/storyletter/box-setup/)). Storylet Studio picks the event, and Patter
plays the conversation for it ([Running it with Patter](https://storylets.dev/play/with-patter/)).

## Where next

- [World Properties](/play/world-properties/) for read-only values.
- [Game Data and addressing](/format/gamedata-and-addressing/) for handing decisions to your game.
