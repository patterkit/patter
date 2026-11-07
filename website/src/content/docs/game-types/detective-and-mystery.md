---
title: Detective and mystery games
description: See how Patter slots into a detective or mystery game, with interviews that open up as clues turn up, evidence to present, and an accusation.
sidebar:
  label: Detective and mystery
---

How Patter slots into a detective or mystery game.

A mystery is told through interviews: the player asks, a witness answers, and what they learn opens new
questions somewhere else. Patter holds the interviews and the flags for what the player knows. Your game keeps
the evidence, shows it, and runs any deduction it has.

## Questions that turn up with the clues

Each clue the player learns is a flag, set by an effect when they hear it. The interview is a
[`choice`](/format/choices-and-logic/#choices-and-options), and an option gated on a clue appears once the
player has it. Each answer jumps back to the list, so the player keeps asking until they're done. Options are
once-only by default, so asked questions go, and a sticky "That's all" stays.

```
(block interview: choice)
> Where were you on Tuesday night?
  WREN: At home. Alone, if you must know.
  (effect: set_flags(@clues, +no_alibi))
  (jump to interview)
> Why was your car at the docks?  (if check_flags(@clues, +car_at_docks))
  WREN: I lent it to my brother.
  (effect: set_flags(@clues, +brother))
  (jump to interview)
> That's all for now.  (sticky)
```

A `flags` [property](/format/property-types/) such as `@clues` holds every clue in one place, and any scene can
test for one.

## Presenting evidence

Showing a witness an item is an option gated on what your game says the player holds. If your game shows the
evidence in its own interface, such as a case file the player picks from, it can play the block for that item
and witness instead, such as `wren-photo`, the same way a
[point and click](/game-types/point-and-click/) game plays a line for an item on a hotspot.

## Witnesses who change their story

A witness who's been caught out should answer differently next time. Put their answers in a
[`branch`](/format/choices-and-logic/#selectors) that tests the clues, most damning first, so the same question
gets a new answer once the player knows more.

## The accusation

The final scene plays the ending that matches the flags: a branch on the clues the player has, most specific
first.
If your game has a deduction board of its own, it decides, reports the verdict as `@world`, and the scene plays
the ending that fits.

## What stays in your game

- The evidence, the case file, and how it's shown.
- Any deduction logic, such as a board where the player links clues.
- Which witness the player is talking to.

## Where Storylet Studio fits

Two of its starting kits suit a mystery. **Codex** gives the player a casebook whose entries unlock as they learn
things, and **News** gives the town a feed that reacts as the case moves. See
[box kits](https://storylets.dev/storyletter/box-setup/).

## Where next

- [Property types](/format/property-types/) for flags and qualities.
- [Coverage testing](/production/coverage-testing/) to see whether the questions behind each clue are ever
  reached.
