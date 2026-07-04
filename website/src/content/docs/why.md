---
title: Why Patter
description: Where Patter fits among narrative tools like Ink, Yarn Spinner, and articy:draft, indie-first but team-ready, files on disk, a screenplay surface for writers, and one bundle that plays identically on every engine.
sidebar:
  label: Why Patter (and how it compares)
---

There are good tools for branching narrative already. This page is for the person
deciding whether to bring one to their team: what Patter optimises for, and how it
differs from the ones you've probably heard of, **Ink**, **Yarn Spinner**, and
**articy:draft**.

The short version: Patter is **indie-first, but team-ready**. Your story is plain files you
own, your writers work in a calm screenplay-style editor (no markup, no node graph), and the
same compiled bundle plays **identically** on JavaScript, Unity, Unreal, and Godot: tested,
not just promised. It leans on your existing version control rather than a server, and because
it can merge a whole team's edits without collisions, that scales from one writer to a large
team on git or Perforce. And it cares about production, localisation, and recording scripts.

## What Patter optimises for

- **Writers who aren't programmers.** The editor, Patterpad, feels like writing a screenplay: character
  cues, lines, directions. There's no scripting syntax to learn and no flowchart to wire.
  A writer is productive on day one. Logic lives in a side panel, never in the prose.
- **Spoken, branching dialogue.** Patter is built around the lines characters *say*, and
  is especially at home when those lines are performed and voiced: every line has its own
  id, a recording status, and a place in the voice script, and a writer can even record a
  rough **scratch take** at their desk to hear a scene read back. Some other tools are aimed
  mainly at on-screen text; Patter is aimed at dialogue you can hear.
- **Files you own, in your version control.** A project is text files on disk: scenes,
  strings, authoring notes, in git, Perforce, Plastic, or SVN. Patter is lock-aware, and it
  combines a whole writing team's edits instead of letting them collide. No database, no
  server, no proprietary store.
- **Built for production, not just the first draft.** Patter tracks how finished each line
  is, shows live production stats, and exports a **voice-recording script** and
  **localisation files** straight from the project, so writing, recording, and translation
  all run off the one source.
- **Review and feedback, built in.** Threaded comments, suggested rewrites, and notes that
  route themselves into the voice script or the translation hand-off all live on the script
  itself, Word/Docs style, in your project files. It's the collaboration layer a plain script
  language leaves to a separate process.
- **One story, every engine.** Your writing compiles to a single `.patterc` bundle, and every
  runtime plays it the same way: choices, conditions, save/load, localisation, even the random
  draws all land identically on each engine. A [shared test suite](/compatibility/)
  proves it, engine by engine.
- **Catch dead content before players do.** A
  [coverage test](/production/coverage-testing/) walks the flow
  thousands of times and flags every beat that's unreachable or only reachable with the right
  game state: narrative QA you can fail a build on in CI.
- **Edit the running game live.** Save in Patterpad and a
  [linked running game](/play/live-debug/) picks up the change without restarting,
  while the editor follows the game's play cursor like a debugger. Reword a line mid-playthrough
  and hear the fix on the next pass.
- **The same operations everywhere.** The editor, the [CLI](/cli/), and CI all run
  the same core, so what you validate in a PR is what the writer sees in the app.
- **Open and free.** MIT-licensed, no seats, no subscription, no telemetry.

## How it compares

| | **Patter** | **Ink** (inkle) | **Yarn Spinner** | **articy:draft** |
|---|---|---|---|---|
| Author writes in | A screenplay-style editor (Patterpad) | A markup language (`.ink`) in Inky | A light node script (`.yarn`) | A visual flow + entity database |
| Learning curve for writers | Low, it reads like a script | Medium: a scripting syntax to learn | Low to medium: nodes plus a little syntax | Medium to high, a rich desktop app |
| Unit of authoring | Complete, identified lines | Woven-together text fragments | Lines inside nodes | Nodes and entities |
| A stable id per line (for translation + audio) | Yes, every line, built in | No: needs community tooling | Yes, line tags for string tables | Database ids |
| Logic | Edited visually, stored beside the prose | Inline in the markup | Inline commands and variables | In nodes plus a variable system |
| Project on disk | Plain text files, VCS-native | A `.ink` file (text, VCS-friendly) | `.yarn` files (VCS-friendly) | A project database (server for teams) |
| Localisation | Built in (two modes, live language switch) | Community tooling | Built in (string tables) | Built in (a core strength) |
| Runtimes | JS, Unity, Unreal, Godot: all tested to match | C#/Unity, JS (inkjs), community ports | Unity-first; community ports elsewhere | Unity and Unreal importers |
| Licence / cost | Open source, free | Open source, free | Open source, free | Commercial (free tier available) |

**Versus Ink.** Ink is a beloved, battle-tested tool, and is the inspiration for
Patter. Its most fundamental choice is
the one that matters most here: Ink was built to weave **text fragments** into flowing
prose, not to author **complete, discrete lines**. A passage of Ink is assembled from
pieces, so there's no stable notion of "this exact line" that stays put as the story
changes. That's wonderful for fluid, reactive text. It is also exactly what makes the two
things many shipping games need most, **translation** and **recorded audio**, hard: with no id
per line, a translator and a voice file have nothing steady to attach to, so both turn to
bespoke, fragile tooling.

Patter is built the other way round. Its unit is a **complete line** with a permanent id,
and everything hangs off that id: a translation is that line in another language, an audio
file is that line's recording. Localisation and voice aren't bolted on later, they fall out
of the model. That difference, honestly, is the reason Patter exists. 

**Versus Yarn Spinner.** Yarn Spinner is a friendly, open-source dialogue system, hugely
popular in Unity (it began life on *Night in the Woods*). Writers work in `.yarn` files:
lightweight nodes with options, commands, and variables, so there's still a little scripting
syntax and a node-graph model to hold in your head. Unlike Ink, Yarn *does* give each line an
id for its string tables, so localisation is first-class, that part of the problem it solves
much as Patter does. Where Patter differs: it puts writers on a **screenplay surface** rather
than a scripting language, keeps logic out of the prose entirely, and ships **one tested runtime per
engine** (JS, Unity, Unreal, Godot) rather than being Unity-first with community ports
elsewhere. If your whole game lives in Unity and your writers are happy in a light markup,
Yarn is a strong, proven choice; Patter aims at teams who want an engine-neutral pipeline and
a writing surface with no syntax at all.

**Versus articy:draft.** Articy is a deep, polished *visual database* for narrative
design: excellent for large teams who want entities, a server, and rich flow diagrams.
Patter is lighter and file-based: no server, no node graph to untangle as the story grows,
and the source lives in your repo next to the rest of the game. If you want a screenplay
your writers own in git or Perforce rather than a database they connect to, Patter is the fit.

## When Patter is *not* the right call

- You want a pure visual **node graph** as the primary authoring metaphor: Articy or a
  flowchart tool will feel more natural.
- You need live, Google-Docs-style **concurrent editing** of the same scene: Patter leans on
  your existing VCS for collaboration (lock-aware, with structural merge), which scales to
  large teams but is check-out-and-merge, not simultaneous co-editing.
- You're already deep in **Ink** and happy writing markup: there's little reason to move.

## Ready to look closer?

- New to the ideas? Start with [Core concepts](/concepts/).
- Want the 10-minute path? [Quickstart](/getting-started/).
- Curious how the pieces connect? [How it fits together](/architecture/).
- Evaluating for a game team? Skim [Playing in your game](/play/overview/) to see
  the integration story for your engine.
