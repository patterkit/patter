---
title: Playtesting your story
description: "The Play window: walk your story live in Patterpad, on the same engine your game will use, with step, continue, speed, captions, and audio."
sidebar:
  label: Playtesting
---

Patterpad can *run* your story, not just show it. The **Play window** walks the real
runtime, the same engine your game will use, so you can take the choices, watch the
branches, and hear how a scene lands before anyone else sees it.

## Starting a playthrough

- **Play ▸ Play Scene** (`⌘P`) opens the play window and starts from the scene you're
  editing.
- **Play ▸ Play from Start** (`⇧⌘P`) runs from the project's [start
  point](/patterpad/projects-and-settings/) instead (you'll be asked to set one
  the first time).
- To start partway in, right-click a block and choose **▶ Play block**.

The window is always on top, so it floats over the editor while you work.

<figure class="doc-shot">
  <img src="/doc-images/PlayWindow.png" alt="The Play window mid-run: a header reading PLAYING FROM the-patter-tour with speed, closed-caption, audio and pin controls, a transcript of played lines, and a tray of choice buttons at the foot." />
  <figcaption>The Play window walks the real runtime. The header shows where the run started, plus speed, closed-caption, audio, and pin controls; played beats build up as a transcript, and eligible choices appear as buttons in the tray at the foot.</figcaption>
</figure>

## The controls

- **▸ Step** plays one beat, a line, a piece of narration, or a game event.
- **Auto-continue** (the **▸▸ Continue** toggle in the header, off by default) turns Step
  into **Continue to next stop**: it plays on to the next choice or the end, revealing one
  line at a time. **◼ Stop** pauses the reveal, and Step/Continue picks it back up.
- **Speed** (Slow / Normal / Fast / Instant) sets how long each line is held before the
  next appears; **Instant** drops the wait entirely. It paces the reveal only, a voiced
  line always plays its full clip.
- Options you can take are buttons; ones whose condition isn't met are shown faded and
  can't be clicked. Pick one and the story moves on.
- **↺ Rewind** (top-left) starts the run again from the top at any time; **↺ Restart**
  shows up at the end.
- **CC** shows or hides the non-spoken [caption cues](/play/closed-captions/) (on
  by default). In an [Audio Folders](/production/audio/) project an **Audio** toggle
  also appears, turning Continue into a table-read that plays each line's recording.

## The editor follows along

As it plays, the editor keeps pace: the current line gets a gliding marker and a soft
wash, everything it's already played picks up a faint "visited" dot, and the editor
changes scenes when the story does. The speaker colours match the ones you see while
writing.

Edit the scene mid-run and the change **applies live**: a reworded line plays its new text the
next time it comes up, and even structural edits carry the run across (the playthrough keeps its
place; a quiet "Edits applied live" note confirms it). Only an edit that doesn't compile yet, say
a half-finished line of logic, pauses the controls with a "Scene changed: restart" note until you
restart or finish the edit.

## Playing in another language

If your project has more than one language, the play window gains a language switcher;
changing it replays the story in that language (lines that aren't translated yet show as
`<Untranslated>`). This is the one place Patterpad renders anything but your source
language. See [Localisation](/production/localisation/).

## Playtesting inside your actual game

The Play window runs the story; sooner or later you want to feel a line inside the **real game**,
with its voices, pacing, and presentation. You can have the same live-edit loop there too: run the
game on your machine, and **saving in Patterpad pushes your edit straight into the running game**,
no rebuild, no restart, no losing your place. Reword a line, save, and the game speaks the new words
the next time it comes up; the editor also follows the game's cursor, highlighting the line being
played.

This needs a one-time hookup on the game side (the **live refresh & debug link**), so ask your
developer to wire it in; it's a few lines, described in
[Live refresh & debug](/play/live-debug/). Once it's in, writers just save.

## Testing every path, not just the one you took

Playing walks *one* route at a time. To check that *every* line is reachable, and to catch
choices that can silently run dry, use the **Coverage Test** (Review ▸ Run Coverage Test). See
[Coverage testing](/production/coverage-testing/).
