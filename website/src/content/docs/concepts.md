---
title: Core concepts
description: The shared vocabulary of a Patter project, scenes, blocks, beats, choices, conditions, properties, Game Data, bundles, localisation, and the runtime family.
sidebar:
  label: Core concepts
---

## Projects and files

A Patter **project** is plain files on disk that you own and keep in version control: scene
files (the structure), localisation files (the translations), authoring files (comments and
writing status), and a project file (the settings). There's no database and no lock-in: diff
it, merge it, zip it, send it. Patterpad and the CLI both respect your version control, so a
read-only or locked file is left alone, not clobbered. → [The format](/format/overview/)

## Scenes, blocks, and beats

The story is a shallow tree. A **scene** holds **blocks**; a block holds **snippets** (and
**groups** that wrap them); a snippet is a run of **beats**. A beat is one of three kinds:

- **line**: a character speaks (a cue + the line).
- **text**: narration the player reads.
- **game event**: a host-facing cue with no spoken text (play a sound, move the camera).

Flow moves by **jumps** (a one-way `jump`, or a `call` that detours and returns) and by **choices**.
→ [Scenes, blocks & beats](/format/structure/)

## Flows

A **flow** is one run through the story: a cursor that starts at a scene and moves from beat to
beat as the player advances. Most games run a single flow, but you can run several at once off the
same story (a main conversation and a side bark, say), each keeping its own position. Global state
(`@patter`) is common to every flow, while `@scene` state and a sequence's memory are **per-flow**
unless you mark them shared. → [The play loop](/play/concepts/#engine-and-flow)

## Choices and selectors

A **choice** offers **options** the player picks from. **Selectors** decide which options
appear and how they repeat: `sequence`, `shuffle`, once-only vs **sticky**, and a
**fallback** that only shows when nothing else qualifies. Every option (and beat) can be
gated by a **condition**. → [Choices & logic](/format/choices-and-logic/)

## Conditions, effects, and properties

Logic is authored visually and stored beside the prose, never woven into it. **Conditions**
gate content; **effects** (on enter / on exit) change state. Both read and write
**properties** you define:

- **`@patter`**: global story variables (gold, reputation, flags).
- **`@scene`**: variables local to one scene.
- **`@world`**: values your *game* owns (threat level, player location), declared so the
  editor type-checks them.

Built-ins like `seen()` and `visits()` track where the player has been.
→ [Conditions, effects & data](/patterpad/conditions-and-data/)

## Game Data and tags

**Game Data** is typed, author-defined data attached to beats and scenes: fields *you*
declare (an emotion, a camera angle, an sfx id) that your game reads off each step to drive
audio, animation, quests, anything. **Tags** are freeform labels that accumulate down the
structure. Together they're how a story hands structured cues to a host without baking engine
specifics into the script. → [Game Data & addressing](/format/gamedata-and-addressing/)

## Bundles

A build compiles the whole project to a **bundle** (a `.patterc`): one portable file with the
scenes, strings, cast, and Game Data a runtime needs, and nothing it doesn't. The bundle is the
only thing you ship. → [The format](/format/overview/)

## Localisation

Patter is multilingual by design. Writers always edit the **source** language; translations
live in locale shards. At build you choose how strings travel:

- **Embedded**: strings ride inside the bundle; the runtime resolves them and can switch
  language live.
- **IDs-only**: the bundle ships ids, not text; your game's own localisation system supplies
  the strings.

→ [Localisation](/production/localisation/)

## The runtime family

A bundle is played by a **Patterplay** runtime. There's one per engine: the JavaScript
runtime (`@patterkit/runtime` + a `patterplay.min.js` drop-in), plus native Unity, Unreal,
and Godot versions. Every runtime plays a story the same way, so what your writers saw is what
your players get: same choices, same saves, same language switching, right down to the random
draws. A [shared test suite](/compatibility/) keeps them honest.
→ [Playing in your game](/play/overview/)
