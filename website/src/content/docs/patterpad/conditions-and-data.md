---
title: Conditions, effects & data
description: "The inspector's visual editors for a story's logic and memory: conditions, effects, properties, Game Data, tags, and addresses."
sidebar:
  label: Conditions, effects & data
---

The story's logic, its conditions, its memory, its data, lives in the **inspector**
(`⌘2`), never tangled into the words on the page. That keeps the script clean to read,
and keeps logic and prose in separate places, so two people can work on each without
stepping on the other.

## Conditions

A **condition** decides whether a piece of content shows. Click a snippet or group's
**Condition** row (or **+ add condition**) to open the visual editor:

- build each test from **pills**: a property, a comparison, a value;
- join them with **and / or**;
- pick properties and built-ins from a menu, no need to remember names;
- or flip to plain text and type the expression yourself.

It checks as you build, and the finished test shows on the bubble as a quiet `if …`
tag. With no condition, the content always shows.

<figure class="doc-shot">
  <img src="/doc-images/ConditionEditor.png" alt="The visual condition editor: an ALL OF THESE group holding two pill clauses, visits(The Crossroads) is 1 AND random(1,6) is 1, above an Add a clause menu listing property comparison, property is true, node seen, visit count, and random chance." />
  <figcaption>The visual expression editor. Each test is built from <strong>pills</strong> (a function or property, its values, a comparison) and combined with an and / or tree. <strong>Add a clause</strong> offers ready-made shapes, property comparison, node seen, visit count, random chance, so you never have to remember the syntax. Node names show as their titles (here <code>The Crossroads</code>).</figcaption>
</figure>

Conditions read the **properties** you've set up (below) and built-ins like `seen()`
and `visits()`, which track where the player has been.

## Effects: making something happen

A snippet can change what the story remembers, either when the player **reaches** it
(*On begin*) or when they **leave** it (*On end*); a scene can do the same on the way in.
Open the row and list the changes you want, set `@gold` to 10, turn `@metTheCaptain` on,
built with the same visual editor as conditions.

Effects change what the story remembers. To make something happen out in your **game**
(play a sound, start a quest), you don't reach for an effect: you leave a **game event** or
some **Game Data** on a beat (below) for your game to act on when the beat plays.

## Properties: the story's memory

Properties are what your story remembers and checks as it plays, gold, reputation,
whether a door has been opened. You give each one a name and a type up front, so the
editor can offer it to you by name and catch a typo before it turns into a bug.

There are three kinds, told apart by who owns them:

- **`@patter`**: remembered for the whole story. Declared in Project Settings ▸ Properties.
- **`@scene`**: the same, but written for a single scene. Declared on that scene.
- **`@world`**: owned by your **game**, not the story, the player's class, the current
  threat level. The story only reads these; your game supplies the values while it runs.
  Declare them in Project Settings ▸ World Properties so the editor knows they exist.

A property can be a **yes/no**, a **number**, some **text**, or a **pick-list** (choose one
value, or choose several). And two built-ins, `seen()` and `visits()`, always know whether,
and how often, the player has been somewhere.

## Game Data: your own fields

**Game Data** is where you hang your own details on the story, the things Patter doesn't
model itself: a mood for a line, a camera angle, the id of a sound to play.

1. In **Project Settings ▸ Game Data**, decide what fields each kind of beat can carry
   (a name, a type, a default value).
2. In the inspector, fill them in on any beat. You only store what you change, so adjusting
   a default updates everywhere you left it alone.

Your game reads these off each beat as it plays. That's how a story hands over its cues, what
to play, where to point the camera, which quest to nudge, without baking your engine into the
script. The [Game Data & addressing](/format/gamedata-and-addressing/) page has the game
side.

## Tags

**Tags** are freeform labels you can stick on anything: a beat, a snippet, a group, a block,
or a whole scene. No setup, just type a word. Use them for whatever cuts across your story:
"act 1", "combat", "tutorial", "barked".

Add them in the inspector's **Tags** row: type and press **Return** or **comma** to add one,
click the **×** to remove it. Each tag gets its own colour. A tag on a scene counts for
everything inside it, so tagging a scene "act1" tags every line in it at once. Your game can
read tags too, see [Game Data & addressing](/format/gamedata-and-addressing/#tags).

## Addresses (Game IDs)

Scenes and blocks have a readable **address** your game uses to start them ("play this
scene"). It follows the name to begin with, and stays muted until you pin it; pinning keeps
the address steady even if you rename the scene later. Either way, renaming never breaks a
jump inside the story. Edit it in the inspector at the scene or block level.

## When something's off

The **problems bar** along the bottom flags issues in plain language as you type, with `‹ ›`
to step through them, and the spot itself is underlined. Many come with a one-click fix: *Add
«name» to cast*, *Set up «prop»*, *Choose where it goes…* for a jump with no target, *Add a
label* for a choice missing its prompt, or *Pick a valid value…*. Spelling suggestions appear
here too, and never block a build.
