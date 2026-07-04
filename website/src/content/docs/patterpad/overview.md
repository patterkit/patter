---
title: Patterpad, the editor
description: A tour of Patterpad, the reading-first desktop editor for branching, performed dialogue.
sidebar:
  label: Overview & workspace
---

**Patterpad** is the desktop app where you write Patter projects. It is built on one
idea: a scriptwriter should be *pleased* to use it. The surface reads like a
screenplay, the serious tooling waits until you reach for it, and the complexity
stays hidden until you ask for it.

This section is a full tour, right down to the many keystrokes, gestures, and menus
that are easy to miss. If you only read one other page, make it
[The writing surface](/patterpad/writing-surface/).

## First run

The first time you launch, Patterpad asks once for your **name** (and an optional
email). That's all, no wizard. Your name signs your review comments and suggestions,
and marks who edited each line. Leave the name blank and Patterpad falls back to your
computer's user name, so skipping the prompt still signs your work sensibly. You can
change either at any time from **User Information** (in the Patterpad app menu on macOS,
or the File menu on Windows and Linux).

From there you land on the **welcome screen**, where you can open a project, create
one, or pick from your recent projects.

### Creating a project

**File ▸ New Project…** (`⌘N` / `Ctrl+N`) opens a simple dialog:

- **Project name**: shows a live preview of the `<name>.patter` folder you'll get.
- **Version control**: git, Perforce, Plastic, SVN, or none. Patterpad sets up the
  right config for whichever you pick, and you can switch it later in Project
  Settings.
- **Publish output**: where **Publish Bundle** writes the finished file. It starts at a
  sibling `../patter-dist/<name>.patterc` and leaves the name alone once you type
  your own path.

Then you **Choose Location** for your Patter project.

A Patter project is a real folder of files (see [the format](/format/overview/)).
On macOS the `.patter` folder opens with a double-click; on Windows and Linux it's an
ordinary folder.

You probably want to store it in whatever VCS you are using for your project, alongside your game files; but you won't be shipping the Patter project itself, only the `.patterc` published bundle.

## Opening where you left off

Patterpad gets you working in one click:

- **Open** a project (`⌘O` / `Ctrl+O`), click a recent one, or use **File ▸ Open
  Recent**.
- It reopens the **last scene you were editing**, with your cursor back on the exact
  line and scrolled into view.
- Double-click a `.patter` folder to reopen your last session, double-click a single
  scene file to open just that scene, or run `patterpad <path>` from a shell.

## The workspace

<figure class="doc-shot">
  <img src="/doc-images/ThreeColumns.png" alt="The Patterpad workspace: a Scenes navigator on the left, the script surface in the centre showing dialogue snippets for The Patter Tour, and the Inspector on the right." />
  <figcaption>The three-column workspace: the Scenes navigator (left), the script surface (centre), and the Inspector (right). The script stays put; the side panes are guests you toggle with <code>⌘1</code> and <code>⌘2</code>.</figcaption>
</figure>

Three columns, with the script always in the centre:

- **Scenes** (left): your list of scenes. The open scene unfolds to list its **blocks** -
  the block your cursor is in stays marked, and clicking one jumps straight to it. **Drag**
  a scene to reorder the list; the order is saved with the project (it changes nothing
  about how the story plays). Add a scene with the **+ New Scene** row at the foot of the
  list (or **File ▸ New Scene…**, `⇧⌘N`); delete one from its right-click menu (or
  **File ▸ Delete Scene…**) - if other scenes jump into it, the confirm names them, and the
  dangling jumps show as problems until you repoint them. Toggle the pane with
  **View ▸ Show Scenes** (`⌘1`).
- **The script** (centre): where you write. This one stays put; the sides are guests.
- **Inspector** (right): the detail for whatever your cursor is on. Toggle with
  **View ▸ Show Inspector** (`⌘2`).

Drag the edge between a pane and the script to resize it, or **double-click that edge**
to reset the pane to its usual width. **View ▸ Reset View** brings both panes back (and
rescues a play window that's drifted off-screen). Patterpad remembers your pane widths
between sessions.

When you want nothing but the words, **Writing View** (`⇧⌘M`) clears everything else
away: both panes, the top bar, and the bottom bars, leaving just the script and the
hint bar. See [Reading & focus](/patterpad/reading-and-focus/).

## Saving

**File ▸ Save** (`⌘S`) saves the current scene. If a teammate has the file locked,
Patterpad respects that and tells you who's holding it, rather than overwriting their
work. **Autosave** is on by default (about every 30 seconds; toggle it in Project
Settings), and Patterpad also saves before switching scenes, playing, or installing an
update.

## Where to go next

- **Learn by playing**: open `examples/projects/tour.patter` and **Play from Start** for an interactive tour of
  choices, selectors, properties, conditions, and closed captions, written as a Patter story.
- [The writing surface](/patterpad/writing-surface/): cues, beats, and every keystroke.
- [Structure & branching](/patterpad/structure-and-branching/): choices, selectors, jumps.
- [Conditions, effects & data](/patterpad/conditions-and-data/): the inspector and the expression editor.
- [Reading & focus](/patterpad/reading-and-focus/): Writing View, reading palettes, and fonts.
- [Search & navigation](/search/): find any line by text, title, address, or id, and replace across the project.
- [Playtesting](/patterpad/playtesting/): walk the story live on the real engine.
- [Reviewing & feedback](/patterpad/reviewing/): comments, suggested rewrites, and delivery-routed notes. (Tracking and reports live under [Running the project](/production/tracking-and-reports/).)
- [Publishing](/patterpad/publishing/): one playable file to send to anyone or put on the web - no engine, no build.
- [Projects & settings](/patterpad/projects-and-settings/): version control, localisation, dictionaries.
- [Keyboard shortcuts](/patterpad/shortcuts/): the full reference.
