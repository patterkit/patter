---
title: Setting up a project
description: For the developer who configures a Patter project so writers can work, the data model, cast, languages, version control, and build, set up once so authors never touch engineering details.
sidebar:
  label: Configuring a project
---

This track is for the person who **sets a project up so writers can work in it**: usually
a developer or technical narrative lead, not the writers themselves. You define the shape of
the world once: the variables the story can read and write, the data your game needs back, the
languages you'll ship, and how the team works together. After that, writers live in
[Patterpad's writing surface](/patterpad/overview/) and never have to touch any of it.

> If you're a writer, you can skip this section: your lead has done it. Head to
> [Writing in Patterpad](/patterpad/overview/).

## What you'll configure

Most of this lives in **Project Settings** (`⌘,`): see the
[settings reference](/patterpad/projects-and-settings/) for a tab-by-tab reference. The
task pages here explain *why* you'd set each thing up and how it affects writers:

1. **The data model**: the `@patter` / `@scene` / `@world` properties the story reads and
   writes, and the **Game Data** your game reads back off each beat.
   → [Properties & game data](/setup/properties-and-data/)
2. **Cast**: the character roster, with display names that can be translated.
   → [Cast](/setup/cast/)
3. **Languages & translation**: the languages you'll ship in and the export/import round-trip
   that keeps writers on the source language.
   → [Languages & translation](/setup/languages/)
4. **Version control**: git, Perforce, Plastic, or SVN, so the team never overwrites each other's
   work.
   → [Version control](/setup/version-control/)
5. **Building & shipping**: compiling the project to the `.patterc` bundle your game loads,
   and choosing how translated text travels.
   → [Building & shipping](/setup/building-and-shipping/)

## Creating the project

**File ▸ New Project…** sets up a fresh project: you pick a name, a location on disk, and a
version-control system up front (you can change it later). Patterpad writes the
[project folder](/format/overview/) and opens it. From there, work through the five areas
above before (or alongside) handing it to writers.

## A sensible setup order

There's no hard sequence, but this order tends to flow:

1. **Declare your properties** (`@patter`, `@scene`) and any **`@world`** values your game owns,
   so conditions are checked from the first scene.
2. **Define Game Data** for the beats your game needs cues from (say, an emotion on lines,
   a sound-effect id on game events).
3. **Add the cast** (or let writers add characters as they go: they join the roster
   automatically).
4. **Add your languages** if you're shipping more than one.
5. **Pick the version-control system** and bring the team in.
6. **Set the build output and localisation mode**, then build a bundle to hand to your engine.

Everything you set up here shapes the editor and the finished bundle, but the writers only ever
see the parts they need: a field to fill in, a property to test against. They can't break the
model, and they never see the plumbing.
