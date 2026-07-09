---
title: Projects & settings
description: Project Settings, version-control awareness, localisation export/import, building a bundle, and spell-check.
sidebar:
  label: Projects & settings
---

## Project Settings

**File ▸ Project Settings…** (`⌘,`) opens a tabbed dialog:

<figure class="doc-shot">
  <img src="/doc-images/ProjectSettings.png" alt="The Project settings dialog: a grouped tab list on the left (Project, Story data, Writing and audio, Localisation) with the Audio Status tab open, showing a Track Audio Status switch, a ladder of recording-status folders, and Use Audio Folders and scratch-recording options." />
  <figcaption>Project settings, with tabs grouped down the left (Project / Story data / Writing &amp; audio / Localisation). The <strong>Audio Status</strong> tab is shown here, mapping each recording stage to a folder on disk.</figcaption>
</figure>

- **General**: project name, the **Start** scene (where the story begins, used by
  **Play ▸ Play from Start** and the coverage test), your version-control system, the
  **voiced** flag, the **formatting** (bold/italic) toggle, **autosave**, **Auto Rebuild**
  (recompile the bundle as you edit, see [below](#building-a-bundle)), the **Build
  output** path, and how strings are handled (**localisation mode**: Embedded or
  IDs-only, with a source-debug option).
- **Language**: the languages your project supports and which one is the source.
- **Game Data**: the fields each kind of beat can carry (see
  [Conditions, effects & data](/patterpad/conditions-and-data/)).
- **Properties**: the `@patter` properties your story remembers.
- **World Properties**: the `@world` values your game owns and your story reads
  (declaring them is covered in
  [Properties & Game Data](/setup/properties-and-data/#world-values-your-game-owns)),
  plus the **coverage drivers** that stand in for them during a
  [coverage test](/production/coverage-testing/#input-drivers).
- **Cast**: your characters: script name, an optional display name for translation,
  notes, and an actor. Each character's colour is shown but chosen for you.
- **Writing Status** / **Audio Status**: the status ladders, each stage with its own
  colour. Audio Status is opt-in (a **Track Audio Status?** switch) and needs the project
  to be **Voiced**; see [Recording status &
  audio](/production/audio/#recording-status).
- **Estimating**: size still-unwritten scenes by a guess instead of their placeholder
  lines, so the report shows the work ahead. See
  [Estimating](/production/tracking-and-reports/#estimating).
- **Closed Captions**: the brackets (default `[` / `]`) and the caption character
  (default `SFX`) your game uses to strip non-spoken cues from dialogue when a player
  turns captions off. Avoid `(` as the opener: parentheses open a performer direction
  at the start of a line. See [Closed captions](/play/closed-captions/).
- **Dictionary**: spell-check setup (below).

The tabs are grouped down the left (Project / Story data / Writing & audio /
Localisation) so the list stays easy to read as it grows.

## Version control

Choose your VCS (git, Perforce, Plastic, SVN, or none) when you create the project or in
**Project Settings ▸ General**. Patterpad is lock- and merge-aware: a scene locked by someone else
goes read-only, your own edits check out when you save, and per-scene badges show each file's
state. The full picture, what needs the VCS tool installed and how Patter merges changes, is on
its own page: [Version control](/setup/version-control/).

## Localisation export / import

**Production ▸ Export / Import Localisation…** hands your text out for translation and
folds it back in (also reachable from the Language settings tab):

- **Export** the text for a language, or a blank template for the source, as **JSON**,
  **Excel (.xlsx)**, or **PO/POT**.
- **Import** a translated file back; the language comes from the file (or you set it),
  and Patterpad tells you how many lines it updated.

Patterpad only ever shows and edits the **source** language; the translations live off
to the side and round-trip through this dialog. The full story is under
[Localisation](/production/localisation/).

## Building a bundle

**Publish ▸ Publish Bundle** (`⇧⌘B`) compiles your project into the `.patterc` file your game
loads (a toast confirms where it landed). This is what you ship to a
[Patterplay runtime](/play/overview/).

The same build runs from the terminal with `patter export`, so you can compile it in a script or a
CI pipeline without opening the app. See [Automation: the CLI](/cli/).

### Auto Rebuild

Turn on **Auto Rebuild** (the **Publish** menu's checkbox, or **Project Settings ▸ General**) and
Patterpad recompiles the bundle for you a moment after you stop editing, so the `.patterc` on disk
stays current without you pressing **Publish Bundle**. Handy when your game reads the bundle straight
from disk and you want to see changes without a manual build.

It's careful about it: the rebuild only writes when the compiled bundle actually **changed** (so it
won't churn the file on cosmetic edits), and if the project is momentarily invalid mid-edit (a
half-written condition, say) it quietly **keeps the last good build** rather than failing. The
existing [stale-bundle check](/setup/building-and-shipping/) still flags a bundle that has fallen
behind.

It's **off by default**, and best left off if you **commit the `.patterc`** to a lock-based version
control system (Perforce or Plastic): rebuilding on every change would keep checking the file out.
With git (or none), and the default gitignored `patter-dist/` output, it's free of side effects.

## Spell-check

Patterpad checks your spelling as you write: a red wavy underline appears under words it
doesn't know in dialogue and narration (character names and your project word list are
left alone). Right-click a flagged word for up to five suggestions, **Add to dictionary**
(it saves to the project word list), or **Ignore** for the session. Set it up under
**Project Settings ▸ Dictionary**: pick a built-in dictionary (en-US / en-GB) or import
your own, and manage your project words. The [Spell-check](/spell-check/) page has
the details.

## Updates

Patterpad keeps itself up to date: **Help ▸ Check for Updates…** downloads the next
version in the background, then asks to relaunch, taking care not to lose unsaved work.
