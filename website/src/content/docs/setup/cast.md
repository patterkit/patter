---
title: Cast
description: "Set up a Patter project's character roster: script names, translatable display names, grammatical gender, actors and notes, and the cue colours writers see everywhere."
sidebar:
  label: Cast
---

The cast is the project's character roster, in **Project Settings ▸ Cast**. Each entry has:

- a **script name**: the cue a writer types (`BARKEEP:`). This is the character's stable
  identity;
- an optional **display name**: the name the player sees, which can be **translated** (so
  `BARKEEP` shows as "The Barkeep" in English and "Le tavernier" in French);
- a **grammatical gender**, sent to translators: free text (blank means not specified), with
  auto-suggest for the everyday values (male / female / neuter) plus any others already used in the
  cast, so a project can name whatever gender a language needs while keeping spellings consistent;
- optional **notes** and an **actor**, for production;
- a **cue colour**, drawn from the name rather than picked, so the same character is the same
  colour everywhere: the editor and the play window alike.

Gender, notes and actor sit behind the ▸ expander on each row.

You don't have to fill the cast in first: when a writer types a new cue, the character **joins
the roster automatically**. Set it up ahead of time only when you want display names, notes, or
actors ready before writing starts. The script name is what runs through the story; the display
name is presentation, chosen per language.

Three things here feed the rest of production: display names are translated as part of
[Languages & translation](/setup/languages/), the **grammatical gender** travels with every
localisation export so a gendered language can inflect that character's lines (see
[Localisation](/production/localisation/#who-is-speaking-grammatical-gender)), and the **actor**
you assign feeds the [voice-recording pipeline](/production/audio/).

## What reaches the game

Only the **script name** and the **display name** are compiled into the published `.patterc`
bundle. Grammatical gender, notes, and the actor's name are project-side context for translators
and the production team; they are deliberately left out, so a game you ship never contains a real
person's name or a writer's private notes about a character.
