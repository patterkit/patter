---
title: Building & shipping
description: Compile a Patter project to the .patterc bundle your game loads, where it writes, how localised strings travel (embedded vs IDs-only), and how to hand a project to someone without shared version control.
sidebar:
  label: Building & shipping
---

Writers work in a [project folder](/format/overview/); the thing you ship is a single
compiled **bundle**. This page covers turning one into the other and getting it to your game.

## Building the bundle

**Publish ▸ Publish Bundle** (`⇧⌘B`) compiles the whole project to a `.patterc`: a single JSON file,
with nothing else attached, and the only file a runtime needs. A toast confirms where it wrote.

- **Output path.** Set it in **Project Settings ▸ Publish**. The default is a
  `patter-dist/` folder next to the project; point it at your game's assets folder so a build
  drops straight in.
- **What's inside.** The scenes, the compiled conditions and effects, the cast, the Game Data
  fields, the addresses your game uses to start scenes, the text (or none, in IDs-only mode), and
  a content hash. You don't commit the bundle to your repo: you rebuild it, you don't merge it.
- **From the terminal.** `patter export` runs the same compile for CI; `patter validate` re-checks
  the bundle's hash to catch a stale build. → [The CLI](/cli/)

## How localised strings travel

The one build decision that affects integration is the **localisation mode** (Project Settings
▸ General):

| Mode | The bundle carries | Your game | Best when |
|---|---|---|---|
| **Embedded** | Every language's text | Reads text straight from the runtime; can switch language live | You want the simplest integration and built-in language switching |
| **IDs-only** | Beat ids, no text | Looks each id up in *your* localisation system | You already have a localisation pipeline and want one source of text |

Both are fully supported, and the runtime works the same way either way
(see [Localisation at runtime](/play/localisation/)). A **source-debug** option adds the
source text alongside the ids, handy while you're developing.

## A readable script (PDF / Word)

To hand someone the script to *read*: a producer, an editor, a reviewer who wants it on paper:
**Publish ▸ Publish Readable Script…** writes a screenplay-style document of the whole project in
reading order: scene and block headings, dialogue (speaker, any performance direction, the line),
prose narration, and the branching laid out plainly: choices as a labelled list (with their
conditions and once-only / repeatable flags), and jumps as “go to …”. Pick **PDF** or **Word
(.docx)** in the Save dialog.

- **It reads top-to-bottom.** Branches sit indented under each choice; it doesn't try to trace
  every path: it's the document of record, not a playthrough (that's the playable HTML).
- **Source language**, cut lines omitted, engine-only beats omitted.
- **PDF vs Word.** PDF uses standard built-in fonts (great for Latin / Western-European text); for a
  non-Latin script (Cyrillic, CJK, …) choose **Word**, which embeds full Unicode fonts.
- **From the terminal.** `patter export-script [path] -o script.pdf` (or `.docx`); the format follows
  the extension. → [The CLI](/cli/)

## A playable HTML to send anyone

When a stakeholder just wants to *play* the story (a producer, a publisher, a client) they don't
need your repo, the editor, or a game build. **Publish ▸ Publish Playable HTML…** writes a single
self-contained **`.html`** file: the Patterplay runtime, the whole compiled story, and a small
reader UI, all inlined. No server, no network, no build step: double-click it and it plays in any
browser, online or off. Email it, drop it in a shared folder, open it on a phone.

- **It's the real runtime.** Choices, conditions, sequences, and jumps behave exactly as they do in
  your game: it's the same engine the bundle ships with, not an approximation. There's a Restart,
  and Save/Load (kept in that browser).
- **Your source language.** The page reads in the project's source language: that's the version a
  stakeholder is reviewing. (For translated text, send a localised build or the loc files instead.)
- **From the terminal.** `patter export-html [path] -o story.html` produces the same file for a
  pipeline (use `-o -` to write it to stdout). → [The CLI](/cli/)

This is for *reading and playing*, not editing: there's no way back into the project from it. To
let someone **edit** and return changes, hand them a `.patterpack` instead (below).

## Handing the project to someone without your VCS

Not every stakeholder is in your repo: a freelance writer, a reviewer, a translator. For them,
`patter pack` produces a single **`.patterpack`** file (a zip, like a `.docx`) holding a full copy
of the project. They edit it, send it back, and `patter unpack --merge` folds their changes back
in, line by line. → [The CLI](/cli/)

## A typical shipping loop

1. Writers finish a pass; you run **Production ▸ Production Information** to check coverage and
   draft status (→ [Writing status](/writing-status/)).
2. You **Publish Bundle** to your game's assets folder.
3. Your game loads the `.patterc` with its [Patterplay runtime](/play/overview/).
4. In CI, `patter validate` gates the bundle, and `patter coverage` can fail the build if a flow
   can't reach its end.

The bundle is engine-agnostic: the *same* `.patterc` plays identically on JavaScript, Unity,
Unreal, and Godot, so you build once and ship everywhere.
