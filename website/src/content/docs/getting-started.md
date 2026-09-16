---
title: Getting started
description: Write a first scene in Patterpad, publish it as a bundle, and play it on the runtime for your engine, in about ten minutes.
sidebar:
  label: Getting started
---

Your first ten minutes with Patter are spent writing a scene. You open Patterpad, name a
project, type a character's cue and the line they say, add another, and press play. The scene
runs in the Play window above the script, and from there the branches, the conditions, and the
game are one step each. This page is that path, from an empty project to a story running in
your engine.

If you would rather read the ideas first, skim [Core concepts](/concepts/) or
[how it fits together](/architecture/).
[PatterKit: A Branching Dialogue System](https://wildwinter.medium.com/patterkit-a-branching-dialogue-system-e0250e6ce045)
introduces the project, where it came from, what is in it, and why it works this way.

:::tip[Prefer to learn by playing?]
The repo ships an **interactive tour** (`examples/projects/tour.patter`), a playable Patter
story that walks you through choices, the three selectors, properties and conditions,
[closed captions](/play/closed-captions/), and the machinery underneath. Open it in Patterpad
and **Play from Start**.
:::

## 1. Get Patterpad

Patterpad is the editor, the desktop app where you write.
[Download it for your platform](/download/) on macOS, Windows, or Linux. It's one
self-contained installer with nothing else needed, and the same page has the runtime plugins
and the CLI.

## 2. Write your story

Create a project with **File ▸ New Project…** and start writing. The surface reads like a
screenplay (character cues, lines, directions), and branching, conditions, and localisation
are there when you reach for them. You can type dialogue immediately and **play it live in
the editor** (`⌘P` / `Ctrl+P`) as you go.

The [Patterpad guide](/patterpad/overview/) is a full tour. The quickest starting points are
[the writing surface](/patterpad/writing-surface/) and
[structure & branching](/patterpad/structure-and-branching/).

## 3. Build a bundle

When the story is ready for your game, **Publish ▸ Publish Bundle** (`⇧⌘B`) compiles the
project to a single **`.patterc`** file with no dependencies. That one file is everything a
runtime needs. (Updating the bundle can be automated.)

## 4. Play it in your engine

A `.patterc` bundle plays the same way on every Patterplay runtime, so a story behaves
identically whatever engine picks it up. On the web, the quickest path is the self-contained
`patterplay.min.js` drop-in, one `<script>` tag with no build step (download it or load it
from a CDN), described on [JavaScript & web](/play/javascript/). Unity (C#), Unreal (C++),
and Godot (GDScript) each have a native plugin with the same API, and
[Playing in your game](/play/overview/) is where those start.

Each runtime loads the bundle and walks it beat by beat (line, narration, choice) while your
game reads its own [Game Data](/format/gamedata-and-addressing/) off each beat to drive audio,
camera, quests, and everything else.

## Prefer the terminal?

The [`patter` CLI](/cli/) validates, compiles, tests, and even plays a project from the
command line, which suits automation and CI. Download a standalone executable for your
platform from the [Download page](/download/).
