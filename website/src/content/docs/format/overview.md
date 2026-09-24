---
title: The Patter format
description: See what a Patter project is on disk, from the shards to the compiled bundle and the send envelope.
sidebar:
  label: Overview
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

Two things follow from this that are worth knowing.

Strings are keyed by a stable beat id, not by position or content, so moving or renaming a
line never orphans a translation.

The committed source carries nothing compiled, so there are no parse trees, no indexes, and
no caches. Anything derived is computed when the project loads, or written to a git-ignored
build file. That's what keeps diffs readable and merges safe.

Files are UTF-8 with LF line endings; the source form is JSON with comments and
trailing commas allowed (`patter validate` enforces the encoding, `patter format`
repairs it).

## The game's shared scopes (`game-scopes/`)

A game with more than one editing tool can keep a **`game-scopes/`** folder beside its projects,
where each tool writes the properties it declares for the others to check against: Patter's is
`patter.scopes.json` (the project's shared `@patter` properties), and the game's own `@world`
lives in `game.scopes.json`. Each file is plain JSON, written the same way every time, and only
when it changes. It lives outside the `.patter` folder, so a project that is packed or checked
out alone keeps its own copy of the game's scopes and still compiles. Patter finds the folder by
walking up from the project; the project file's `gameScopes` field names it when it lives
elsewhere. [Properties & Game Data](/setup/properties-and-data/#sharing-scopes-with-the-games-other-tools)
covers what it's for.

## The compiled bundle (`.patterc`)

`patter export` (or **Publish Bundle** in Patterpad) compiles the whole project into a
single **`.patterc`** file: plain UTF-8 JSON, never a zip. It carries exactly what a
runtime needs and nothing more: the scene structure, compiled conditions and effects,
the assembled locale strings (or none, in IDs-only mode), the cast (player-facing names
only), the Game Data schema, resolved addresses, and a content hash.

Authoring context is deliberately left behind. A [cast member's](/setup/cast/) notes,
grammatical gender, and the **voice actor's name** belong to your team, your translators, and
your recording pipeline; only the script name and display name are compiled in. A game you ship
therefore carries no real person's name, and no private notes about a character.

The bundle is what you ship, and what every [Patterplay runtime](/play/overview/)
plays. By default it's committed to your repo and regenerated rather than merged;
`patter validate` recomputes its hash so you catch a stale one.

## The send envelope (`.patterpack`)

For handing a project to someone *without* shared version control, `patter pack`
produces a single **`.patterpack`** file (a zip, like a `.docx`). It's a lossless copy
of the shards, not a second source of truth, and being a single binary file is the
point: it says "this is a delivery, not the canonical files." `patter unpack
--merge` folds a returned pack's edits back into the project by id.

Where the project has a [`game-scopes/` folder](#the-games-shared-scopes-game-scopes), the pack
also carries every `*.scopes.json` in it as `game-scopes/<name>` entries (the files as they are on
disk), named in the manifest's `gameScopes` list. It's a read-only snapshot for the recipient:
unpacking writes it into `game-scopes/` inside the new project folder, and a merge never writes it
back. A project with no folder packs exactly as before.

## Why it's shaped this way

Nothing here is proprietary. Your narrative is text files you can read, diff, and search
with anything, and you author them in Patterpad or through the CLI.

The shape is VCS-native. Per-scene shards and a stable, line-oriented file form mean a
normal 3-way text merge works in any VCS, with
[`patter merge`](/setup/version-control/#how-merges-work) as an id-aware upgrade when you
want it.

It is also survivable. Because nothing derived is committed, even a messy merge can't
corrupt a hidden cache, and the source on disk is always the whole truth.

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
