---
title: Roguelikes
description: See how Patter slots into a roguelike, with lines that react to each run and death, variety over many runs, and state that lasts between them.
sidebar:
  label: Roguelikes
---

How Patter slots into a roguelike.

A roguelike is played many times over, and its characters have to keep up: a hub character who knows how the
last run ended, a boss who remembers beating you, lines that don't repeat across fifty runs. Patter holds those
lines and remembers which have played. Your game runs the runs, and decides what carries over between them.

:::tip[Coming soon]
Upcoming Patter extensions will help marshal conversations in your engine, drive lipsync, and manage their
integration with cutscene animation.
:::

## Lines that react to the last run

Report what happened as [`@world` properties](/play/world-properties/), such as the run count, what killed the
player, and how far they got. A [Best match](/format/choices-and-logic/#best-match-lines-that-fit-the-moment)
group then plays the line that fits the run most closely: the one whose condition holds the most facts true, with
a line that has no condition as the filler when nothing stands out.

```
(Best match, repeat)
(if @world.killed_by == "warden" and @world.runs > 10)
SMITH: The Warden again? You'll have him one day.
(if @world.killed_by == "warden")
SMITH: The Warden got you, then.
(if @world.killed_by == "warden")
SMITH: Keys on his belt, axe in his hand. Watch the axe.
(if @world.depth >= 5)
SMITH: Five floors down. Further than most.
SMITH: Back again.
SMITH: You look terrible. Sit down.
```

A veteran killed by the Warden gets the first line, since its condition holds two facts. A newer player killed by
him on the upper floors gets one of the two Warden lines, which tie, so Best match shuffles between them and
never plays the same one twice in a row. Killed by him five floors down, the depth line ties with them too, and
joins the shuffle. A run with nothing special gets one of the fillers. With `repeat`, the group scores again every time,
so it keeps up as the runs go on.

## Remarks that are used up

Some lines should only ever be said once, such as the smith's remarks on the bosses the player has beaten. Best
match with `once` uses each line up as it plays, so the group slides down from the most specific line to the
general ones, one per visit. Specificity counts the facts a condition holds true, and `check_flags` counts each
flag it checks, so the line for both bosses outranks the line for either.

```
(Best match, once)
(if check_flags(@world.beaten, +warden, +queen))
SMITH: The Warden and the Queen, both. They'll be singing about you.
(if check_flags(@world.beaten, +warden))
SMITH: They're still talking about the Warden in the tavern.
(if check_flags(@world.beaten, +queen))
SMITH: Nobody's mourning the Queen, I can tell you.
```

A player who's beaten both hears the first line, then the other two on later visits, in a seeded shuffle since
they tie. Write the general lines so they still make sense after the specific one.

Once every line is used, the group has nothing to say. When your game plays it with `runFlow`, an
[empty result](/play/navigation/#play-an-address) is the cue to play the ordinary greeting instead.

## Idle chatter that doesn't repeat

While the player kits out in the hub, characters fill the silence. A `sequence` set to `shuffle` deals its lines
in a random order without repeats, and never plays the same line twice in a row
([Selectors](/format/choices-and-logic/#selectors)). With `repeat`, it shuffles the pack again once it's empty.

```
(sequence, shuffle, repeat)
SMITH: Hammer's not going to swing itself.
SMITH: Mind the sparks.
SMITH: If you find good iron down there, bring it back.
SMITH: Some days I think the dungeon grows overnight.
```

With `once` instead, each line is heard once in that flow (or once for everyone, if the sequence is shared, as
below), which suits lore: a bag of stories the hub
characters tell, a few per run, until they've told them all.

## Two characters, one pack of rumours

When two characters draw from the same lines, mark the sequence's memory as
[shared](/format/choices-and-logic/#selectors), so a rumour one of them has told is gone for the other too. Each
character plays it in their own [flow](/play/navigation/#name-the-flow-one-per-speaker), and the shared pack
keeps them from repeating each other.

## Lessons in order

The first few deaths can teach, in order, then settle on a line. A sequential `sequence` with `stick` plays its
lines one per visit and holds on the last.

```
(sequence, sequential, stick)
SMITH: First time? Everyone dies on the first floor.
SMITH: Try blocking. It's the button you haven't pressed.
SMITH: You'll get there.
```

`visits()` counts how often the player has been somewhere in this flow, and `patter_visits()` across every
flow, for as long as the save is kept, so a scene can also check whether this is the tenth visit to the hub, or the hundredth.

## Seeded, so a run can be replayed

Everything Patter chooses by chance comes from a seeded generator: the order of a shuffle, a tie in Best match,
and `random()` in a condition or effect. Give the engine the same
[seed](/play/engine/#constructing-the-engine), the same choices from the player, and the same values from your game, and it plays the same lines,
on all four runtimes. The generator's position is part of a [save](/play/integration/#save-and-load), so a loaded
game carries on exactly where it left off rather than drawing again.

That suits a roguelike's seeded runs. Share a seed for a daily challenge, and every player hears the same lines
along the way. Replay a reported run from its seed and inputs, and the dialogue does what it did for the player.
Storylet Studio's deals are seeded the same way, so a run that uses both can be replayed whole.

## What lasts between runs

Patter's state saves in [one call](/play/integration/#save-and-load), and your game decides what to keep. Save
the story's state with your meta-progression and the hub remembers everything across runs. If something should
reset each run, such as a per-run flag, set it back from your game when a run starts, with
[`setProperty`](/play/play-helpers/).

## What stays in your game

- The runs, the rooms, the enemies, and what killed the player.
- What carries over between runs, by what it saves.
- When the hub characters get to speak.

## Where Storylet Studio fits

A good fit, and for more than dialogue. A roguelike deals things out over and over as conditions change, which
is what Storylet Studio is built for. You don't have to use it for any of these, and your game may already
handle some of them its own way, but it can help with each.

- **Key story beats:** which conversation the hub has after a run, and when the next piece of the story is
  ready, gated on the player's progress across runs.
- **Encounters, monsters, and items:** which turn up on this floor, as cards with conditions on depth, run
  count, or what the player carries, and with fields such as `value` or `danger` that your game reads.
- **Events during a run:** a shrine, a trapped chest, a stranger by the road, dealt from a pool so a run never
  plays out the same way twice.

Storylet Studio picks what turns up, and your game runs it: the fight, the loot, the floor. When a card leads
into a conversation, Patter plays it ([Running it with Patter](https://storylets.dev/play/with-patter/)).

## Where next

- [Choices and logic](/format/choices-and-logic/) for shuffle, Best match, and exhaust.
- [Save and load](/play/integration/#save-and-load) for what a save holds.
