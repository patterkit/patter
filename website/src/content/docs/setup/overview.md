---
title: Setting up a project
description: Set up a Patter project once, from properties and cast to languages and version control, so writers never touch the plumbing.
sidebar:
  label: Configuring a project
---

This track is for the person who sets a project up so writers can work in it, usually a
developer or a technical narrative lead rather than the writers themselves. You define the
shape of the world once. That means the variables the story can read and write, the data your
game needs back, the languages you'll ship, and how the team works together. After that,
writers live in [Patterpad's writing surface](/patterpad/overview/) and never have to touch
any of it.

> If you're a writer, your lead has done all of this and you can skip the section. Head to
> [Writing in Patterpad](/patterpad/overview/).

## What you configure

Most of this lives in **Project Settings** (`⌘,`), and the
[settings reference](/patterpad/projects-and-settings/) walks it tab by tab. The task pages
here explain *why* you would set each thing up and how it affects writers.

[Properties & game data](/setup/properties-and-data/) is the data model. It covers the
`@patter`, `@scene`, and `@world` properties the story reads and writes, and the **Game Data**
your game reads back off each beat.

[Cast](/setup/cast/) is the character roster, with display names that can be translated.

[Languages & translation](/setup/languages/) covers the languages you ship in and the
export/import round-trip that keeps writers on the source language.

[Version control](/setup/version-control/) is git, Perforce, Plastic, or SVN, set up so the
team never overwrites each other's work.

[Building & shipping](/setup/building-and-shipping/) compiles the project to the `.patterc`
bundle your game loads, and chooses how translated text travels.

## Creating the project

**File ▸ New Project…** sets up a fresh project. You pick a name, a location on disk, and a
version-control system up front (you can change it later). Patterpad writes the
[project folder](/format/overview/) and opens it. From there, work through the five areas
above before (or alongside) handing it to writers.

## A sensible setup order

There's no hard sequence, but this order tends to flow.

1. Declare your properties (`@patter`, `@scene`) and any `@world` values your game owns, so
   conditions are checked from the first scene.
2. Define Game Data for the beats your game needs cues from (say, an emotion on lines, a
   sound-effect id on game events).
3. Add the cast, or let writers add characters as they go, since they join the roster
   automatically.
4. Add your languages if you're shipping more than one.
5. Pick the version-control system and bring the team in.
6. Set the build output and localisation mode, then build a bundle to hand to your engine.

Everything you set up here shapes the editor and the finished bundle, but the writers only
ever see the parts they need, a field to fill in or a property to test against. They can't
break the model, and they never see the plumbing.
