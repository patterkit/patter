---
title: The Patter format
description: What a Patter project is on disk, the shards, the compiled bundle, and the send envelope.
sidebar:
  label: Project & files
---

A Patter project is **plain files you own**. There's no database and no server: the
folder on disk *is* the source of truth, built to live in your version control and to
diff and merge like any other text in the repo. This page walks through the on-disk
shape; the [Specification](/specification/) is the formal reference.

## The `.patter` project

A project is a folder marked with the `.patter` extension. On macOS it's registered
as a document *package* (so it opens with a double-click, Scrivener-style); on Windows,
Linux, and in your VCS it's an ordinary folder. Inside, the content is split into small
**shards** so several people can work at once without colliding, and so a 3-way merge
stays clean.

### The shards

| Shard | Holds | Notes |
| --- | --- | --- |
| **`.patterflow`** | one **scene**'s structure: blocks, groups, snippets, beats, conditions, selectors, jumps | No prose, no audio. Tiny and stable, so it merges cleanly. |
| **`.patterloc`** | the **strings** for one scene in one locale, keyed by beat id (`loc/<locale>/<scene>.patterloc`) | Text only. Even the source language lives here, not in the flow. |
| **`.patterx`** | all volatile **authoring metadata**: comments, documentation notes, writing/recording status, the edit trail, cut markers, estimates, suggestions | Stripped at export. Merges by union of ids. |
| **`.patterproj`** | project **settings**: cast, properties, Game Data schema, status ladders, locales, VCS kind | The thing the editor "opens." Found by walking up the directory tree. |

Two things follow from this that are worth knowing:

- **Strings are keyed by a stable beat id**, not by position or content, so
  moving or renaming a line never orphans a translation.
- **The committed source carries nothing compiled**: no parse trees, no indexes, no
  caches. Anything derived is computed when the project loads, or written to a
  git-ignored build file. That's what keeps diffs readable and merges safe.

Files are UTF-8 with LF line endings; the source form is JSON with comments and
trailing commas allowed (`patter validate` enforces the encoding, `patter format`
repairs it).

## The compiled bundle (`.patterc`)

`patter export` (or **Publish Bundle** in Patterpad) compiles the whole project into a
single **`.patterc`** file: plain UTF-8 JSON, never a zip. It carries exactly what a
runtime needs and nothing more: the scene structure, compiled conditions and effects,
the assembled locale strings (or none, in IDs-only mode), the cast, the Game Data
schema, resolved addresses, and a content hash.

The bundle is what you ship, and what every [Patterplay runtime](/play/overview/)
plays. By default it's committed to your repo and regenerated rather than merged;
`patter validate` recomputes its hash so you catch a stale one.

## The send envelope (`.patterpack`)

For handing a project to someone *without* shared version control, `patter pack`
produces a single **`.patterpack`** file (a zip, like a `.docx`). It's a lossless copy
of the shards, not a second source of truth, and being a single binary file is the
point: it says "this is a delivery, not the canonical files." `patter unpack
--merge` folds a returned pack's edits back into the project by id.

## Why it's shaped this way

- **No lock-in**: your narrative is text files you can read, diff, and search with
  anything; you author them in Patterpad or through the CLI.
- **VCS-native**: per-scene shards and a stable, line-oriented file form mean a
  normal 3-way text merge works in any VCS, with
  [`patter merge`](/setup/version-control/#how-merges-work) as an id-aware
  upgrade when you want it.
- **Survivable**: because nothing derived is committed, even a messy merge can't
  corrupt a hidden cache; the source on disk is always the whole truth.

### A note on audio

Audio is an optional add-on, not part of the core: the model, format, compiler, and
runtime are all text, and a project with no audio is complete and valid. Any audio
lives **outside** the document, named by beat id (`<beatId>.wav` / `.mp3`) so a clip
always maps back to its line. If you turn on **Audio Folders**, Patterpad reads each
line's recording status from per-status folders and can play a scene back at
performance pace. See
[Recording status & audio](/production/audio/#recording-status).

## Read on

- [Scenes, blocks & beats](/format/structure/): the narrative tree and jumps.
- [Choices & logic](/format/choices-and-logic/): selectors, conditions, properties, expressions.
- [Game Data & addressing](/format/gamedata-and-addressing/): typed host data and the two ids.
- [Localisation](/production/localisation/): locale shards and the two bundle modes.
