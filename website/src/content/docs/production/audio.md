---
title: Audio and recording
description: Track each line's recording status from the audio on disk, play a scene back as a table-read, record scratch voice clips at your desk, and hear stand-in speech before anyone records.
sidebar:
  label: Audio and recording
---

Alongside [writing status](/writing-status/), Patterpad can track a separate
**recording status** for the voice work: how far along each spoken line's audio is. This is
where a producer manages the recording pipeline, and where a scene can be played back as a
performed table-read.

## Recording status

Recording status works just like writing status (an ordered, colour-tinted ladder edited in
**Project Settings ▸ Recording status**), with two differences. It applies to **dialogue lines
only** (text and game event beats never carry one), and the default ladder runs
**missing → scratch → recorded → final**. A line with no status set reads as the lowest
stage, **missing**.

Recording status is **off by default** and opt-in, even for a voiced project (you might want
voice scripts without tracking every voice clip). Turn it on with the **Track audio status** switch
at the top of the **Recording status** tab. The project also has to be
[**Voiced**](/patterpad/projects-and-settings/) (General tab); until both are on, no
Audio row shows in the inspector, and recording figures stay out of the production report and
its spreadsheet.

Audio has three pages in Project Settings: **Recording status** (the stages, and how they're tracked),
**Scratch recording**, and [**Placeholder Speech**](/production/placeholder-speech/). The last two need
Audio Folders, below.

There are two ways to track it, chosen per project on the **Recording status** page.

Tracking it **manually** is the default. Select a line and pick its stage from the **Audio** dropdown
in the inspector, exactly like the Writing dropdown.

The other way is **Audio Folders**. Turn on **Use Audio Folders** and set one **audio root** folder.
Each stage then gets its own subfolder under that root, named automatically from the stage (so
`../audio` gives `../audio/scratch/`, `../audio/recorded/`, `../audio/final/`) with the lowest "not
recorded" stage having none.

Patterpad reads every line's recording status straight from the files. Drop a line's `.wav`, `.ogg`
(Ogg Vorbis), or `.mp3` into a stage's folder and the line takes that stage. If a line's audio sits in more than one
stage, the **most finished** one wins (a `recorded/` voice clip beats a `scratch/` one), and a line with no
file anywhere reads as **missing**. The folders are watched live, so adding or removing a file
updates the status on its own. Here the inspector shows the status as a **chip** you can't edit (it
comes from the files) with a **▶ play button** next to any line that has a clip.

> Each audio file is named after the line's **id**, not its wording or where it sits, so
> editing a line, moving it, or reordering it never loses track of its recording. To find a
> line's id, select it and click the **#id** in the inspector header to copy it; or paste an
> id into [search](/search/) (or run
> [`patter resolve <id>`](/cli/#patter-resolve-query-path)) to go the other way, from a
> filename back to the line. The same id keys the line's [translations](/production/localisation/).
> See [the IDs explained](/format/gamedata-and-addressing/#the-two-ids).

Recording status feeds the same places as writing status. **Filter by it** with **Review ▸
Find Lines by Recording…** (or the search window's **Recording** mode), and it's broken down
per character in the [Production Information report](/production/tracking-and-reports/#the-writing-status-rollup).

### Which format to use

Patterpad plays all three formats. If one folder holds more than one for the same line, WAV wins, then
OGG, then MP3, so a lossless master always beats a compressed copy. Scratch voice clips recorded in Patterpad are
saved as WAV.

What your game can use depends on what imports it:

| Format | Unity | Unreal | Godot | Wwise | Browsers |
| --- | --- | --- | --- | --- | --- |
| WAV | Yes | Yes | Yes | Yes | Yes |
| OGG | Yes | Yes | Yes | No | Chrome, Edge, and Firefox; not reliably Safari |
| MP3 | Yes | Yes | Yes | No | Yes |

Unity, Unreal, and Godot import all three (Unreal plays imported sound assets, not the files themselves).
Wwise takes WAV, so a Wwise project keeps its voice clips as WAV. OGG is much smaller than WAV, so it suits a game
that ships a lot of voice. Safari's support for Ogg Vorbis came late and isn't dependable, so if a web game
has to play in Safari, use MP3. [Placeholder Speech](/production/placeholder-speech/) is WAV, at 16 kHz (24 kHz with HD voices).

Every status folder names a line's voice clip the same way, so never merge status folders into one: a line's
scratch voice clip and its recorded voice clip would have the same name, and one would overwrite the other. Copy the
files the manifest names instead (below).

### Flagging a line for a retake

Sometimes a line is recorded but the voice clip is no good: poor quality, a fluff, the wrong
pronunciation. The file is there, so its recording status (whether you set it by hand or derive it
from Audio Folders) reads as **recorded** or **final**, and the line would quietly be skipped next
session. To catch it, tick **Needs re-record** on the line in the inspector.

A re-record flag is a **separate status that overrides the normal one**: wherever recording status
is shown or counted, a flagged line reads as **re-record** instead of its rung on disk. So it
reappears in the recording script as work to do, and the production report pulls it into its own
**re-record** tally rather than leaving it hidden in "recorded". The audio file itself is untouched
(you can still play the bad voice clip from the inspector) until a new one replaces it.

Patterpad also ticks it for you when you **change what a recorded or final line says**: the voice clip no
longer matches the script. Undo the edit and the tick goes with it. Changing only spaces or
formatting, or the line's direction, leaves it alone, since the actor would say the same words. A
line with no voice clip yet, or only a scratch voice clip or [placeholder speech](/production/placeholder-speech/),
isn't flagged: placeholder speech is made again on its own.

When you tick it and the line has no [VO note](/patterpad/reviewing/) yet, Patterpad opens the note
editor so you can jot down **why** it needs redoing. That note travels with the line into the
recording script, so whoever records the retake sees the reason. The flag lives in your project, not
in the shipped game.

## Getting the audio into your game

Patter itself doesn't play audio in engine: your engine and audio tooling do. The durable hook is the line
**id** from the callout above, and plenty of teams tie voice-over straight to that id through their own
audio system or middleware and skip the rest of this section.

If you'd rather have Patterpad do the file-picking for you, it's an **optional** convenience: on
**Publish Bundle** (or **Production ▸ Update Audio Manifest**), Patterpad writes a small
`patteraudio.json` next to your audio listing each line's winning file. Ship the audio folder, point a
tiny resolver at it, and the runtime maps a beat to its clip (it finds the file; you still play it). The
runtime side is on [Audio (runtime)](/play/audio/).

The audio folders are **source**, not what you ship. Each engine has its own import or packaging step
(Unity's import, Unreal's cook, Godot's export filters, a web build's copy), so include the status folders
you want to ship and leave the rest, the placeholder and scratch folders among them, out. The manifest names
only voice clips whose line is still in the project, so a deleted line's voice clip never reaches a game.

For a release build, write a shipping manifest to your build folder with
`patter export --audio-manifest-out build/patteraudio.json --no-placeholder-speech`: it leaves Placeholder
Speech out, so it names no file you didn't package, and the manifest beside your audio stays as it was for
development builds. Its files are named relative to the audio root, as in the development one.

## Voice clips for deleted lines

A voice clip whose line is gone is no use to anyone, so Patterpad clears them up as you go:

- Delete a line and its **placeholder speech** goes straight away (it can be made again).
- Its **scratch voice clip** goes **a week later**, in case you undo, switch back to a branch, or paste the line
  somewhere else. Cut a line and paste it, and its voice clip moves to the pasted line at once.
- **Recorded and final voice clips are never touched.**

Patterpad only counts a line as deleted when you deleted it, by an edit on your computer. A line that
disappears because you synced an older script, switched branch, or reverted is left alone, and so are voice clips
for lines your copy of the script has never had (a teammate's new lines, before you pull them). Each delete
goes through your version control, so a committed voice clip is still in its history.

**Production ▸ Remove Voice Clips for Deleted Lines…** clears every scratch and placeholder voice clip with no line now,
whatever its age, after listing them.

## Playing with audio

When a project is in Audio Folders mode, the **Play** window gains an **Audio** toggle. With
it on, **Continue** becomes a *table-read*: each line plays its clip, and the next line follows
when the clip and the line's [pause](/patterpad/writing-surface/#pauses-between-lines) allow, so the
scene plays back at performance pace, cut-ins included. A line with no clip is timed by how long it
would take to read, so the read stays in rhythm. **Speed** plays the clips slower or faster, with
their pitch kept, so a fast read still sounds like the actor. **Step** still moves one beat at a time,
playing each line's clip as you go. See [Playtesting](/patterpad/playtesting/).

## Recording scratch voice clips

In Audio Folders mode you can also record quick **scratch voice clips** right inside Patterpad, a
fast way to hear a scene before you book a session. It's the one bit of the audio pipeline a
**writer** reaches for as much as a producer. Rough a line in your own voice, at your desk,
and hear the scene read back. Turn on **Enable scratch recording** on the **Scratch recording** page
and choose which stage's folder the voice clips land in (the **scratch** stage by default).

Then, for any line **at or below** the scratch stage (one that hasn't already got a more
finished voice clip), the inspector shows a **● Record** button. Click it and a full-screen recorder
takes over, opening on a **cue screen** with the line, its speaker, and a badge saying where its
existing voice clip stands (**No voice clip yet**, **Voice clip out of date** because the line was edited after it
was recorded, or **Voice clip up to date**). From there, press **Space** to record. A **3, 2, 1**
countdown runs, then it records your microphone while everything else pauses, and **Space** again
finishes the voice clip (or **Esc** cancels). Patterpad trims the silence off each end, saves the
voice clip into the scratch folder, and the line's status updates to match. No files to shuffle.

After each voice clip you can **replay** it, **re-record** it, or carry straight on. **Record
next ▸** moves to the following line, and **Next needed ▸▸** jumps ahead to the next line
whose voice clip is missing or out of date, skipping everything already covered. The same skip
buttons are on the cue screen, so a tidy-up pass works from anywhere. Open the recorder on
any line, hop from needed line to needed line, and stop when nothing's left. The next-line
preview carries the same badge, so you always know whether the suggested line actually needs
a voice clip before committing to it.

Each voice clip remembers the exact line it was recorded against, so if you later edit that line,
the inspector flags it **⚠ out of date**, and the recorder's badges pick out exactly which
scratch needs redoing. The words are kept in the WAV itself, in a `PTRK` chunk. (Voice clips from Dink and from
earlier versions of Patterpad keep them in a `DINK` chunk, which is still read.)

A line with only [placeholder speech](/production/placeholder-speech/) counts as needing a voice clip: **Next
needed** stops at it, as it does at a line with nothing.
