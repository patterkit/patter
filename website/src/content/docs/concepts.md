---
title: Core concepts
description: Learn the words a Patter project is built from, from scenes and beats to the bundle and the runtimes that play it.
sidebar:
  label: Core concepts
---

## Projects and files

A Patter project is plain files on disk that you own and keep in version control. The
scene files hold the structure, the localisation files hold the translations, the authoring
files hold comments and writing status, and a project file holds the settings. There's no
database. You can diff a project, merge it, zip it, and send it. Patterpad and the CLI both
respect your version control, so a read-only or locked file is left alone rather than
clobbered. [The format](/format/overview/) describes every file.

## Scenes, blocks, and beats

The story is a shallow tree. A **scene** holds **blocks**, a block holds **snippets** (and
**groups** that wrap them), and a snippet is a run of **beats**. A beat is one of three kinds.
In a `line` a character speaks, with a cue and the line. A `text` beat is narration the player
reads. A game event is a host-facing cue with no spoken text, such as playing a sound or
moving the camera.

Flow moves by **jumps** (a one-way `jump`, or a `call` that detours and returns) and by
**choices**. [Scenes, blocks & beats](/format/structure/) has the detail.

## Flows

A **flow** is one run through the story. It's a cursor that starts at a scene and moves from
beat to beat as the player advances. Most games run a single flow, but you can run several at
once off the same story (a main conversation and a side bark, say), each keeping its own
position. Global state (`@patter`) is common to every flow, while `@scene` state and a
sequence's memory are per-flow unless you mark them shared. [The play
loop](/play/concepts/#engine-and-flow) shows how a game drives one.

## Choices and selectors

A **choice** offers **options** the player picks from. **Selectors** decide which options
appear and how they repeat, whether in `sequence` or `shuffle`, once only or **sticky**, with a
**fallback** that only shows when nothing else qualifies. Every option (and every beat) can be
gated by a **condition**. [Choices & logic](/format/choices-and-logic/) covers each selector.

## Conditions, effects, and properties

Logic is authored visually and stored beside the prose, never woven into it. **Conditions**
gate content. **Effects** (on enter and on exit) change state. Both read and write
**properties** you define. `@patter` properties are global story variables (gold, reputation,
flags). `@scene` properties are local to one scene. `@world` properties are values your *game*
owns (threat level, player location), declared so the editor can type-check them. Built-ins like
`seen()` and `visits()` track where the player has been. [Conditions, effects &
data](/patterpad/conditions-and-data/) shows the editors for all of this.

## Game Data and tags

**Game Data** is typed, author-defined data attached to beats and scenes. You declare the
fields (an emotion, a camera angle, an sfx id) and your game reads them off each step to drive
audio, animation, quests, anything. **Tags** are freeform labels that accumulate down the
structure. Together they're how a story hands structured cues to a host without baking engine
specifics into the script. [Game Data & addressing](/format/gamedata-and-addressing/) has the
rules for both.

## Bundles

A build compiles the whole project to a **bundle**, a `.patterc` file. It's one portable file
with the scenes, strings, cast, and Game Data a runtime needs, and nothing it doesn't. The
bundle is the only thing you ship, and [the format](/format/overview/) describes what is in it.

## Localisation

Patter is multilingual by design. Writers always edit the **source** language, and
translations live in locale shards. At build you choose how strings travel. In **Embedded**
mode the strings ride inside the bundle, the runtime resolves them, and it can switch language
live. In **IDs-only** mode the bundle ships ids rather than text, and your game's own
localisation system supplies the strings. The translation loop itself is on the
[localisation](/production/localisation/) page.

## The runtime family

A bundle is played by a **Patterplay** runtime, and there's one per engine. The JavaScript
runtime is `@patterkit/runtime` (with a `patterplay.min.js` drop-in), and the Unity, Unreal,
and Godot runtimes are native. Every runtime plays a story the same way, so what your writers
saw is what your players get, with the same choices, the same saves, the same language
switching, and even the same random draws. A [shared test suite](/compatibility/) keeps them
honest, and [Playing in your game](/play/overview/) is where an integration starts.
