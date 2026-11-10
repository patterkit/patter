---
title: Linear action games
description: See how Patter slots into a linear action game, with cutscenes, briefings, radio during play, barks, and a voice script to record from.
sidebar:
  label: Linear action
---

How Patter slots into a linear action game.

A linear action game tells its story in cutscenes and briefings, and keeps it going during play with radio
chatter and barks. Most of it is voiced. Patter holds every line and the cues that go with them, and its
tools record and track the voice. Your game runs the mission, decides when each line is due, and plays the audio.

:::tip[Coming soon]
Upcoming Patter extensions will help marshal conversations in your engine, drive lipsync, and manage their
integration with cutscene animation.
:::

## Cutscenes and briefings

Write a scene per cutscene or briefing. Lines carry the cues your game needs as
[Game Data](/setup/properties-and-data/#game-data-what-your-game-reads-back): a camera shot, an animation, a
mood for the performance. Wordless [game events](/format/structure/#beats) carry the rest, such as a sound, a
door opening, or a cut to the next shot.

```
(game event: camera = "wide-hangar")
COMMANDER: You've got twenty minutes before the convoy leaves.
  (camera: close-commander)
COMMANDER: Get in, plant the charges, get out.
(game event: animation = "squad-stands")
```

[Structure introspection](/play/structure/) lists every beat with its Game Data without playing it, so a
cutscene can be laid out as tracks in your engine's sequencer, one per beat.

## Radio during play

Radio runs over the action, so it plays in a [flow](/concepts/#flows) of its own while the player's flow carries
on. A [speaker qualifier](/setup/cast/#speaker-qualifiers) such as `COMMANDER (RADIO)` tells your game to put
the voice through the radio filter, and it's still the same character.

## Barks on events

When something happens, such as an enemy spotted, a reload, or a grenade, your game plays a bark block for that
event, one [flow per speaker](/play/navigation/#name-the-flow-one-per-speaker) so each soldier works through the
lines on their own. Shuffle keeps them from repeating, and
[Best match](/format/choices-and-logic/#best-match-lines-that-fit-the-moment) picks the line that fits, such as
one for low health and one for a generic hit. [Tags](/format/gamedata-and-addressing/#tags) group barks across
scenes for your game to filter.

## Lines cut off and lines that overlap

A beat's [`padAfter`](/format/structure/#beats) sets the pause after it, and a negative one starts the next line
before this one ends, so a character can cut in. When your game has to stop a conversation, such as when the
speaker is hit, it closes the flow or sends it to another block. [Navigation](/play/navigation/) covers moving
and [finishing flows](/play/navigation/#finished-flows).

## Recording the voice

Every line has a recording status and a place in the voice script, and writers can record a scratch voice clip at
their desk to hear a scene before the actors do. [Audio](/production/audio/) covers the production side. Each
line's text is its subtitle, and cues in brackets, such as `[explosion]`, are
[closed captions](/play/closed-captions/) that players can turn off.

## What stays in your game

- The mission, the triggers, and the timing of every line.
- Playing the audio and the animation, and interrupting them.
- Which lines matter more when two are due at once.

## Where Storylet Studio fits

Rarely. A linear game knows what comes next.

## Where next

- [Audio](/production/audio/) for recording and delivering voice.
- [Game Data and addressing](/format/gamedata-and-addressing/) for the cues your game reads.
