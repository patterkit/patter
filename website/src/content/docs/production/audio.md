---
title: Audio & recording
description: "Track each spoken line's recording status in Patterpad, derive it from audio files on disk, play a scene back as a table-read, and record quick scratch takes at your desk."
sidebar:
  label: Audio & recording
---

Alongside [writing status](/writing-status/), Patterpad can track a separate
**recording status** for the voice work: how far along each spoken line's audio is. This is
where a producer manages the recording pipeline, and where a scene can be played back as a
performed table-read.

## Recording status

Recording status works just like writing status (an ordered, colour-tinted ladder edited in
**Project Settings ▸ Audio Status**), with two differences. It applies to **dialogue lines
only** (narration and game event beats never carry one), and the default ladder runs
**missing → scratch → recorded → final**. A line with no status set reads as the lowest
stage, **missing**.

Recording status is **off by default** and opt-in, even for a voiced project (you might want
voice scripts without tracking every take). Turn it on with the **Track Audio Status?** switch
at the top of the **Audio Status** tab. The project also has to be
[**Voiced**](/patterpad/projects-and-settings/) (General tab); until both are on, no
Audio row shows in the inspector, and recording figures stay out of the production report and
its spreadsheet.

There are two ways to track it, chosen per project on the **Audio Status** tab:

- **Manually** (the default): select a line and pick its stage from the **Audio** dropdown in
  the inspector, exactly like the Writing dropdown.
- **Audio Folders**: turn on **Use Audio Folders** and set one **audio root** folder. Each stage
  then gets its own subfolder under that root, named automatically from the stage (so `../audio`
  gives `../audio/scratch/`, `../audio/recorded/`, `../audio/final/`) with the lowest "not recorded"
  stage having none. Patterpad reads every line's recording status straight from the files: drop a
  line's `.wav` (or `.mp3`) into a stage's folder and the line takes that stage. If a line's audio
  sits in more than one stage, the **most finished** one wins (a `recorded/` take beats a `scratch/`
  one), and a line with no file anywhere reads as **missing**. The folders are watched live: add or
  remove a file and the status updates on its own. Here the inspector shows the status as a **chip**
  you can't edit (it comes from the files) with a **▶ play button** next to any line that has a clip.

> Each audio file is named after the line's **id**, not its wording or where it sits, so
> editing a line, moving it, or reordering it never loses track of its recording. To find a
> line's id, select it and click the **#id** in the inspector header to copy it; or paste an
> id into [search](/search/) (or run
> [`patter resolve <id>`](/cli/#patter-resolve-query-path)) to go the other way, from a
> filename back to the line. The same id keys the line's [translations](/production/localisation/).
> See [the IDs explained](/format/gamedata-and-addressing/#the-two-ids).

Recording status feeds the same places as writing status: **filter by it** with **Review ▸
Find Lines by Recording…** (or the search window's **Recording** mode), and it's broken down
per character in the [Production Information report](/production/tracking-and-reports/#the-writing-status-rollup).

## Getting the audio into your game

Your game can play the right take for each line with no folder-search of its own. On **Publish Bundle** (or
**Production ▸ Update Audio Manifest**), Patterpad writes a small `patteraudio.json` next to your audio
listing each line's winning file. Ship the audio folder, point a tiny resolver at it, and the runtime
maps a beat to its clip. → [Audio (runtime)](/play/audio/)

## Playing with audio

When a project is in Audio Folders mode, the **Play** window gains an **Audio** toggle. With
it on, **Continue** becomes a *table-read*: each line plays its clip and the next beat waits
for it to finish, so the scene plays back at performance pace. A line with no clip is timed at
a natural reading speed so the read stays in rhythm. **Step** still moves one beat at a time,
playing each line's clip as you go. See [Playtesting](/patterpad/playtesting/).

## Recording scratch takes

In Audio Folders mode you can also record quick **scratch takes** right inside Patterpad, a
fast way to hear a scene before you book a session. It's the one bit of the audio pipeline a
**writer** reaches for as much as a producer: rough a line in your own voice, at your desk,
and hear the scene read back. Turn on **Enable scratch recording** on the **Audio Status** tab
and choose which stage's folder the takes land in (the **scratch** stage by default).

Then, for any line **at or below** the scratch stage (one that hasn't already got a more
finished take), the inspector shows a **● Record** button. Click it and a full-screen recorder
takes over: a **3·2·1** countdown, then it records your microphone while everything else
pauses. Press **Space** to finish (or **Esc** to cancel). Patterpad trims the silence off each
end, saves the take into the scratch folder, and the line's status updates to match. No files
to shuffle.

The take remembers the exact line it was recorded against, so if you later edit that line, the
inspector flags it **⚠ out of date**, telling you which scratch needs redoing.
