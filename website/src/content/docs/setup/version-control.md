---
title: Version control
description: How a Patter project collaborates through git, Perforce, Plastic, or SVN, lock-aware writes, per-scene status badges, and a CLI that behaves the same way for CI.
sidebar:
  label: Version control
---

A Patter project is **plain text files**, so it lives in whatever version-control system your
team already uses. Patterpad doesn't replace your VCS, it *works with* it, so authors don't
overwrite each other and a CI pipeline sees exactly what the editor does.

## Choosing a system

Pick the VCS when you **create the project**, or change it later in **Project Settings ▸
General**. Patter supports the four common in games:

- **git** and **SVN** are merge-based: everyone edits, and changes merge together. Because Patter
  splits the story into one file per scene, and those files are clean and line-by-line, an
  ordinary text merge just works.
- **Perforce** and **Plastic SCM** are lock-based: a file is checked out (and often locked to one
  person) before editing. Patterpad understands this and checks files out when you save.
- **none**: a plain project on disk with no version-control features at all.

Patter drives these through their **own command-line tools** (`git`, `p4`, `cm` for Plastic,
`svn`), rather than reimplementing each one. So the CLI for the system you pick needs to be
**installed and on your PATH**, the same tool you would run from a terminal. (The **none** option
needs nothing.)

Switching systems in settings writes the new config files and clears out the old system's leftover
ones.

## What Patterpad does for you

Every save goes through your version-control system, so the editor reflects and respects the
state of the repo:

- **Locked scenes are read-only.** If another author holds a scene (on a lock-based VCS), its
  surface and inspector dim, and a chip in the top bar names who has it, so you don't waste
  effort on a file you can't save.
- **Editable scenes check out when you save.** You write freely; the checkout happens on save,
  not on every keystroke.
- **Per-scene badges** in the navigator show the state at a glance: locked (⊘), out of date (↓),
  checked out by you (✎), modified (●), or new (+). They keep themselves up to date.

If you chose **none**, everything is editable and none of these markers appear.

## How merges work

A project isn't one big file. It's split into small [pieces](/format/overview/): one
structure file per scene, a separate text file per language, and a companion file for the editor's
own notes. That alone avoids most conflicts, two writers in different scenes touch different files,
and the files are written to diff and merge cleanly (readable, line-by-line, with a stable id on
every line so a moved or renamed line keeps its translation).

On top of that, Patter installs a **structured merge** that understands the format. Instead of
merging line by line, it merges by each node's **id**:

- Two people adding **different** snippets, options, or scenes both keep their work, even side by
  side.
- Editing **different fields** of the same node (one changes a condition, one rewrites the line)
  combines cleanly.
- A **real** clash, the same line edited two different ways, or one node moved to two different
  places, is flagged rather than guessed at.

Patter wires this into your VCS for you: on **git** it registers a merge driver, and on
**Perforce / Plastic / SVN** a merge tool (`patter init` writes the config and prints the one-time
commands where a system needs them).

When there *is* a real conflict, Patter never leaves raw `<<<<<<<` markers inside your files: the
merged file stays valid and provisionally keeps your side, and the clash is recorded in a
**`.patterconflict`** file next to it. A leftover `.patterconflict` is an error that
[`patter validate`](/cli/) reports, so an unresolved merge can't be built or shipped by
accident.

## Same rules for automation

Both Patterpad and the [`patter` CLI](/cli/) go through your version control the same way.
A `patter validate` in CI, a scripted `patter export`, or a writer hitting Save all respect locks
and check out the same way, so the editor and your pipeline never behave differently. Gate a pull
request on `patter validate`: it sees the project exactly as the editor does.
