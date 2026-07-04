---
title: Quickstart
description: From nothing to a playable branching story, write in Patterpad, build a bundle, and play it on the runtime for your engine.
sidebar:
  label: Quickstart
---

Patter has two halves: you **write** in Patterpad, and you **play** what you write
with a Patterplay runtime. Here is the path from zero to a story running in your
game. New to the ideas? Skim [Core concepts](/concepts/) or
[how it fits together](/architecture/).

:::tip[Prefer to learn by playing?]
The repo ships an **interactive tour** (`examples/projects/tour.patter`): a playable Patter story that walks you
through choices, the three selectors, properties and conditions,
[closed captions](/play/closed-captions/), and the machinery
underneath. Open it in Patterpad and **Play from Start**.
:::

## 1. Get Patterpad

Patterpad is the editor: the desktop app where you write.
**[Download it for your platform &rarr;](/download/)** - macOS, Windows, or Linux, one
self-contained installer, nothing else needed. (The same page has the runtime plugins
and the CLI.)

## 2. Write your story

Create a project with **File ▸ New Project…** and start writing. The surface reads
like a screenplay (character cues, lines, directions) and branching, conditions,
and localisation are there when you reach for them. You can type dialogue
immediately and **play it live in the editor** (`⌘P` / `Ctrl+P`) as you go.

The [Patterpad guide](/patterpad/overview/) is a full tour; the quickest
starting points are [the writing surface](/patterpad/writing-surface/) and
[structure & branching](/patterpad/structure-and-branching/).

## 3. Build a bundle

When the story is ready for your game, **Publish ▸ Publish Bundle** (`⇧⌘B`) compiles the
project to a single **`.patterc`** file with no dependencies. That one file is
everything a runtime needs. (Updating the bundle can be automated.)

## 4. Play it: choose your runtime

A `.patterc` bundle plays the same way on every Patterplay runtime, so a story behaves
identically whatever engine picks it up. Pick the one for your engine:

- **Web / JavaScript / TypeScript**: the quickest path is the self-contained
  `patterplay.min.js` drop-in: one `<script>` tag, no build step (download it or load
  it from a CDN). → [JavaScript & web](/play/javascript/)
- **Unity (C#)** · **Unreal (C++)** · **Godot (GDScript)**: native plugins with the
  same API. → [Playing in your game](/play/overview/)

Each runtime loads the bundle and walks it beat by beat: line, narration, choice,
while your game reads its own [Game Data](/format/gamedata-and-addressing/) off
each beat to drive audio, camera, quests, and everything else.

## Prefer the terminal?

The [`patter` CLI](/cli/) validates, compiles, tests, and even plays a project from the
command line: handy for automation and CI. Download a standalone executable for your
platform from the [Download page](/download/).
