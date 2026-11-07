---
title: Walking sims and audio-log games
description: See how Patter slots into a walking sim or audio-log game, with narration as the player explores, recordings that play once, and subtitles.
sidebar:
  label: Walking sims
---

How Patter slots into a walking sim or an audio-log game.

These games tell their story as the player explores: a narrator who comments on where they are, recordings they
find, voices in the next room. There's little or no choice, and nearly everything is voiced. Patter holds the
narration and the recordings and remembers what's been heard. Your game decides when the player has reached
somewhere, and plays the audio.

:::tip[Coming soon]
Upcoming Patter extensions will help marshal conversations in your engine, drive lipsync, and manage their
integration with cutscene animation.
:::

## Narration by place

Write a scene per area, and play its block when the player arrives. Report where they are as a
[`@world` property](/play/world-properties/) if the narration needs to know what else they've seen on the way.

## Recordings that play once

Each recording is a block. Play each one with
[`runFlow`](/play/navigation/#play-an-address) under a flow name that lasts, so a recording that's been used up
stays used up. `patter_seen()` tells a later line whether the player has heard a recording in any flow (plain
`seen()` only counts the flow it's asked in), so the narrator can react to it, or fall back to another line if
the player walked past it.

```
(block kitchen)
(branch)
(if patter_seen(cellar-log))
NARRATOR: She knew about the cellar. That's why she left in such a hurry.
NARRATOR: The kettle's still warm. Someone left in a hurry.
```

## Narration over everything else

Narration runs in a [flow](/concepts/#flows) of its own, so it can play while a recording or the room's voices
carry on in another. Your game decides which one wins when two want to speak.

## Voice first, with subtitles

Every line has a recording status and a place in the voice script, and writers can record a scratch take to
hear the pacing before the actors do ([Audio](/production/audio/)). Each line's text and speaker label are the
subtitle. Cues in brackets, such as `[static]` or `[a door slams]`, are
[closed captions](/play/closed-captions/), which players who can hear the audio can turn off.

## What stays in your game

- The triggers that say the player has arrived somewhere.
- Playing the audio, and fading one voice under another.
- The recordings as objects in the world, and how they're picked up.

## Where Storylet Studio fits

Optional. Its **Stash** kit suits finds that turn up as the player explores, with one find that only turns up
once another points the way ([box kits](https://storylets.dev/storyletter/box-setup/)).

## Where next

- [Audio](/production/audio/) for recording and delivering voice.
- [Closed captions](/play/closed-captions/) for cues players can turn off.
