---
title: Reviewing & feedback
description: "Threaded comments, suggested rewrites, and delivery-routed documentation notes, plus the review walk that steps through every open note, all anchored to the script inside Patterpad."
sidebar:
  label: Reviewing & feedback
---

Patterpad is built for the back-and-forth of a real production, not just the first draft.
Comments, suggested rewrites, and notes all live **on the script itself**, Word/Docs style,
and travel in the project's own files, never into what ships to your game. It's the kind of
collaboration a plain script language (Ink, say) leaves to a separate document; here it sits
right next to the line it's about.

## Threaded comments

Right-click a beat or chunk and choose **Add comment…** to start a discussion thread,
Word/Docs style. Each thread carries your name and a timestamp, and lives in the project's own
file, never in what ships to your game.

- Select **text within a line** first and the comment highlights just that span; otherwise it
  attaches to the **whole beat** with a marker in the gutter.
- **Click a commented span** to open its thread.
- **Mark a thread complete** to tuck it away. Bring archived threads back with **Review ▸ Show
  Resolved Comments** (it starts off each time you launch).

## Suggested rewrites

Right-click a dialogue or narration beat and choose **Suggest rewrite…** to propose a new line
without touching the original. A pencil in the gutter opens the review, where you can
**Accept** the proposal (it makes the edit) or **Reject** it. If the original line has changed
since, the suggestion is flagged **stale**. Bring archived proposals back with **Review ▸ Show
Resolved Suggestions**. It's a script-editor's redline, an editor can float a better line
without overwriting the writer's.

## Documentation notes

Comments are for discussion; **documentation notes** explain the content itself: what a line
is for, the context around it, how to pronounce a name in the booth. Right-click ▸ **Note…**
to add one. Each note has a **class**, and the class decides who receives it:

- **Everyone**: always shown;
- **Voice (VO)**: rides along into the recording script;
- **Localisers**: rides along into the translation hand-off.

So a pronunciation note reaches the voice actor and a context note reaches the translator,
each in the export that's meant for them, without cluttering anyone else's view. Which classes
you can pick depends on the beat (no VO note on narration or a game event, no localiser note
on a game event). Choose which classes you see while editing under **View ▸ Notes**. A note
with no class is yours alone: it can never slip into an export.

## The review walk

**Review ▸ Review Feedback** (`⌘⇧R`) turns on a looping bar along the bottom that walks you
through every open comment and suggestion in the *whole project*. **F8** / **Shift+F8** move to
the next and previous. Land on one and it loads its scene, reveals the beat, and opens the
thread, so you can clear feedback end to end without going looking for it.

---

Tracking how done the writing is, the coverage test, and the production reports and exports
live under **Running the project**: see [Tracking & reports](/production/tracking-and-reports/).
