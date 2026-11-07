---
title: Point and click adventures
description: See how Patter slots into a point and click adventure, with look, use, and talk on every hotspot, looks that change, and topics that run out.
sidebar:
  label: Point and click
---

How Patter slots into a point and click adventure.

A point and click adventure has a line for almost everything the player can do: look at the desk, use the key
on the door, talk to the barman. Patter holds those lines and the conversations, and remembers what's been said.
Your game runs the verbs, the inventory, and the puzzles, and asks Patter for the right lines.

:::tip[Coming soon]
Upcoming Patter extensions will help marshal conversations in your engine, drive lipsync, and manage their
integration with cutscene animation.
:::

## A line for every verb and hotspot

Write a scene per room and a block per hotspot and verb, such as `look-desk`, `use-desk`, and `talk-barman`.
When the player clicks, your game builds the address from the verb and the target and
[plays it](/play/navigation/#play-an-address) with `runFlow`. Keep one flow name per hotspot or character, so
each one remembers its place: which look comes next, and which topics have been asked.
[Name the flow, one per speaker](/play/navigation/#name-the-flow-one-per-speaker) explains why.

An address that doesn't exist is an error, so your game needs to know which ones do. Read the scene's blocks
once with [structure introspection](/play/structure/) and keep a table. When there's no block for the
combination, play a generic one, such as `use-default`, with "I can't use that" and its variations.

## A look that changes the second time

Put the lines in a [`sequence`](/format/choices-and-logic/#selectors). Sequential with `stick` gives a fresh
line on each look and keeps the last one. Shuffle with `repeat` suits a generic "That won't work" that shouldn't
sound the same every time.

```
(block look-desk: sequence, sequential, stick)
ROSA: An old desk. Someone's carved their initials in it.
ROSA: "J.M." I wonder who that was.
  (effect: @saw_initials = true)
ROSA: Still just a desk.
```

## Item on item, item on hotspot

A combination is a block at its own address, such as `use-key-door`. Its lines can check what the player holds,
and its effects can set the flags your game acts on.

```
(block use-key-door: branch)
(if @world.has_brass_key)
ROSA: It fits.
  (effect: @world.cellar_open = true)
ROSA: None of my keys fit this lock.
```

Your game reads `@world.cellar_open` and opens the door. The inventory, and which combinations work, stay in
your game: Patter reads them as [`@world` properties](/play/world-properties/) and only writes the ones you mark
writable.

## Hub conversations

Most conversations in an adventure are a hub: a list of topics the player picks from, each answered, then back
to the list until they say goodbye. In Patter the hub is a block holding a
[`choice`](/format/choices-and-logic/#choices-and-options), and each option ends with a
[jump](/format/structure/#jumps) back to that block.

- **Asked questions go.** Options are once-only by default, so a topic disappears once it's been asked.
- **New topics turn up.** An option with a condition appears when it passes: after the player has seen the
  initials, found the photo, or heard a name somewhere else.
- **Some topics stay.** Mark an option sticky to keep it, such as "Tell me about the town again".
- **The way out.** A sticky "Goodbye" ends the conversation from any point. Without one, a fallback option is
  taken by itself once everything else has been asked, so the barman can wrap things up.

```
(block hub: choice)
> Seen anyone strange around here?
  BARMAN: Only you.
  (jump to hub)
> Who's J.M.?  (if @patter.saw_initials)
  BARMAN: Jim Morrow. Used to run this place.
  (jump to hub)
> Goodbye.  (sticky)
  BARMAN: Mind the step.
```

The next time the player talks to the barman, your game plays the hub again, and only the topics they haven't
asked, plus any new ones, are offered. A greeting block before the hub can change with how often you've
visited, using `visits()`, which counts within the flow it's asked in (`patter_visits()` counts across every
flow).

## What stays in your game

- The verb interface, the hotspots, and building the address.
- The inventory, which items combine, and the puzzle logic.
- Walking the character over and facing them the right way before the line plays.

## Where Storylet Studio fits

Two of its starting kits suit an adventure. **Conversation topics** gives a hint character a hand of things to
bring up, and **Codex** gives the player a journal that fills in as they learn things. See
[box kits](https://storylets.dev/storyletter/box-setup/).

## Where next

- [Navigation](/play/navigation/) for playing an address, and for
  [trying one without consequences](/play/navigation/#trying-an-address-without-consequences).
- [Choices and logic](/format/choices-and-logic/) for every selector and option flag.
