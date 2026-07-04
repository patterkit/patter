---
title: Properties & game data
description: Set up the data model of your story, @patter, @scene, and @world properties the narrative reads and writes, and the typed Game Data your game reads back off each beat.
sidebar:
  label: Properties & game data
---

Two kinds of data flow through a Patter story, and as the project lead you define both:

- **Properties**: variables the *story* reads and writes (gold, reputation, whether the player
  knows a secret). Writers test and set these in conditions and effects.
- **Game Data**: values the *game* reads back off each beat (an emotion, a camera angle,
  a sound-effect id) to drive how it's presented.

This page is the setup side. Writers see the same features from their side in
[Conditions, effects & data](/patterpad/conditions-and-data/); the format-level model is
in [Game Data & addressing](/format/gamedata-and-addressing/).

## Properties: the story's variables

Declare properties in **Project Settings ▸ Properties** (for `@patter`) and on the scene itself
for `@scene`. Each has a **name**, a **type** (yes/no, number, text, a pick-list, or a set of
flags), and a default. Once declared, the editor offers them by name in the condition and effect
editors and checks every use: a writer can't compare a number against a word, or test a property
that doesn't exist.

| Scope | Lives | Use it for |
|---|---|---|
| **`@patter`** | Whole story, saved | Global state: `@gold`, `@reputation`, story flags. |
| **`@scene`** | One scene, saved | Bookkeeping local to a scene: `@scene.asked_about_work`. |
| **`@world`** | Your game owns it | Values the game sets while it runs: `@world.threat`, `@world.location`. |

A short, well-named property list is a kindness to writers: the condition editor stays easy to
use, and there are fewer ways to write a logic bug.

## `@world`: values your game owns

Some branches depend on things the *game* knows, not the story: the player's location, a
difficulty setting, a live threat level. Declare those in **Project Settings ▸ World Properties**
as `@world` values (name, type, default, and whether the story is allowed to change them). Two
payoffs:

- The editor **checks** `@world.*` references, so a condition against a value your game feeds is
  validated like any other.
- While the game runs it **supplies** these values; if nothing sets them, the runtime falls back
  to the defaults you declared (see [Save/load & Game Data](/play/integration/)).

One thing to know now: because the game sets `@world` values while it runs, the editor's
[coverage test](/production/coverage-testing/) can't know them, so a branch gated on
`@world.threat` shows up as *needs input* until you give the test stand-in values. Those
stand-ins, **coverage drivers**, live in the same World Properties tab and are covered with
the test itself: see [Input drivers](/production/coverage-testing/#input-drivers).

## Game Data: what your game reads back

Properties drive the *story*; **Game Data** hands cues to the *game*. In **Project
Settings ▸ Game Data**, decide what fields each kind of beat can carry: for example, an `emotion`
pick-list on **line** beats, a `camera` field on **text**, an `sfx` id on a **game event**. Each
field has a name, a type, and a default.

Writers then see only the fields that apply to the beat they're on, and fill them in from the
inspector. A beat only stores the fields you actually change, so adjusting a default updates
everywhere you left it alone. While the game runs it reads these off each beat in one call,
merged with the defaults (see [Save/load & Game Data](/play/integration/)). This is how a
story tells your game "play this line *angrily*, with the camera *close*" without ever naming
your game in the script.

> **Properties vs Game Data, in one line:** properties are things the story *changes*; Game Data is
> notes the game *reads*. Use a property when a later beat needs to test it; use Game Data when
> only the game cares.

## Tags

For lighter, freeform labelling, writers can add **tags** to beats and structure (`#flashback`,
`#tutorial`). A tag on a scene or group counts for everything inside it, and every tag reaches
your game as the beat plays: no setup, nothing to declare. They're ideal for marks that cut
across the story and don't warrant their own field.
→ [Game Data & addressing](/format/gamedata-and-addressing/)
