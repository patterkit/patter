---
title: Visual novels
description: See how Patter slots into a visual novel, with routes, relationships, and endings, an expression on every line, and text the player has already read.
sidebar:
  label: Visual novels
---

How Patter slots into a visual novel.

A visual novel is almost all dialogue, so Patter carries most of the writing: every line, every choice, and the
flags that decide which route the player is on. Your game draws the text box, the characters, and the
backgrounds, and keeps the save slots.

## Chapters and routes

Write a scene per chapter, and let choices set the flags that decide the route. Route flags and affection are
`@patter` [properties](/format/choices-and-logic/#properties): they belong to the story, last the whole game,
and save with it. A [`branch`](/format/choices-and-logic/#selectors) at the end of a chapter sends the player
down the route their flags point to, with an unconditional last child as the default.

```
MIO: So, are you coming to the festival?
> I wouldn't miss it.
  (effect: @route = "festival")
  MIO: Then I'll save you a spot.
> I've got work, sorry.
  (effect: @route = "work")
  MIO: Oh. Another time, then.
```

## An expression on every line

A visual novel shows a portrait, an expression, and a background for each line. Declare those as
[Game Data](/setup/properties-and-data/#game-data-what-your-game-reads-back) fields once, such as an
`expression` pick-list on line beats and a `background` on scenes, and writers set them in the inspector as they
write. Your game reads them off each step and swaps the art. Music and sound cues can ride on wordless
[game events](/format/structure/#beats).

```
(scene Game Data: background = "rooftop")
MIO: You came!
  (expression: happy)
MIO: I wasn't sure you would.
  (expression: shy)
```

## Choices that stay or go

An option is once-only by default, so a question the player has asked disappears. Mark it
[sticky](/format/choices-and-logic/#the-flags) to keep it. A fallback option is taken when nothing else is left,
which is how a run of questions ends with "That's all for now". Options gated on a condition reach your game as
unavailable rather than hidden, so you can show a locked choice if your design wants one.

## Narration and inner voice

Prose with no speaker is a [text beat](/format/structure/#beats). A thought is a line with a
[speaker qualifier](/setup/cast/#speaker-qualifiers), such as `MIO (V.O.)`, so it's still Mio speaking and
your game can style it differently. Values drop into text and choices with `{@name}`
([Embedding property values](/format/choices-and-logic/#embedding-property-values-in-text)).

## Text the player has already read

Every beat has a stable id that never changes when the writing moves. Keep a set of the ids your game has shown,
and you have "skip read text" and a backlog that knows what's new.

## Saving anywhere

One call [saves the whole story](/play/integration/#save-and-load), mid-scene and mid-choice, and one call
restores it. Your game decides when to save and how many slots there are, and stores the save with its own.

## Relationships and affection

Many visual novels are about relationships: what the player says to someone moves how they feel, and new scenes
open as it grows. Each relationship is a `@patter` [property](/format/choices-and-logic/#properties), in whichever
[type](/format/property-types/) fits it:

- **A number** for affection that goes up and down.
- **A [quality](/format/property-types/#quality-the-stage-of-a-story)** for a stage that only moves forward, such
  as strangers, friends, and close.
- **[Flags](/format/property-types/#flags-any-of-these)** for facts that build up, such as met, owes you a
  favour, and saw you lie.

Effects on options move them, and conditions gate the scenes and options that need a closer relationship.

```
JUN: Do you ever think about leaving this town?
> Every day.
  (effect: @jun_affection = @jun_affection + 2)
  JUN: Me too. I've never told anyone that.
> Not really. I like it here.
  JUN: Huh. I suppose someone has to.
```

An ending scene follows the values the story has built up: a branch, most specific first, with a default ending
last. [Coverage testing](/production/coverage-testing/) plays every route and shows any ending nobody can reach.

## What stays in your game

- The text box, portraits, backgrounds, and transitions, driven by Game Data.
- The backlog, skip, and auto-advance.
- Save slots, and when the game saves.
- The calendar and time of day, if the story has them.

## Where Storylet Studio fits

You won't need it for fixed routes. It earns its place when the story has free time: the player picks who to
spend an afternoon with, and which scenes are on offer depends on the day, who they've grown close to, and what's
happened so far. That's a pool of scenes with conditions, dealt as the story moves, which is what Storylet Studio
is for. Its **Story acts** kit gives you an arc in acts, with beats that wait for their act. Storylet Studio picks
the scene, your game plays the Patter scene of the same name, and both read the same values
([Running it with Patter](https://storylets.dev/play/with-patter/)).

## Where next

- [Choices and logic](/format/choices-and-logic/) for every selector and option flag.
- [Make an interactive story for the web](/web-story/) for a small browser player you can build on.
- [Localisation](/production/localisation/) when the novel goes into other languages.
- [Sharing scopes with the game's other tools](/setup/properties-and-data/#sharing-scopes-with-the-games-other-tools)
  for one set of values across Patter and Storylet Studio.
