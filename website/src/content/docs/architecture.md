---
title: How it fits together
description: The Patter ecosystem at a glance, the Patterpad editor and the CLI author a project, compile it to one portable bundle, and the Patterplay runtimes play it identically on every engine.
sidebar:
  label: How it fits together
---

Patter is a small family of tools around one idea: **author a story as plain files, compile
it to one portable bundle, and play that bundle identically on any engine.** This page shows
how the pieces connect, so the rest of the docs make sense in context.

## The dataflow

<svg viewBox="0 0 744 262" role="img" aria-labelledby="pk-flow-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-flow-title">Writers author a project in Patterpad; the patter CLI (or Patterpad's own Build menu) compiles the project into one .patterc bundle; a Patterplay runtime loads and plays that bundle, identically in JavaScript, Unity, Unreal, and Godot.</title>
  <defs>
    <marker id="pk-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/>
    </marker>
  </defs>
  <!-- Patterpad -->
  <rect x="14" y="95" width="120" height="50" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <rect x="14" y="95" width="120" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="74" y="118" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Patterpad</text>
  <text x="74" y="134" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">the editor</text>
  <!-- author -> project -->
  <text x="150" y="112" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10" style="text-transform:uppercase" letter-spacing="1">author</text>
  <path d="M134 122 H164" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-arrow)"/>
  <!-- Project on disk -->
  <rect x="166" y="95" width="146" height="50" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <rect x="166" y="95" width="146" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="239" y="118" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Project on disk</text>
  <text x="239" y="134" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">text files, in your VCS</text>
  <!-- project -> CLI -->
  <path d="M312 122 H342" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-arrow)"/>
  <!-- patter CLI (the compiler) -->
  <rect x="344" y="95" width="104" height="50" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <rect x="344" y="95" width="104" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="396" y="117" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="12">patter CLI</text>
  <text x="396" y="134" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">compiles</text>
  <!-- CLI -> bundle -->
  <text x="467" y="112" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10" style="text-transform:uppercase" letter-spacing="1">build</text>
  <path d="M448 122 H484" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-arrow)"/>
  <!-- bundle -->
  <rect x="486" y="103" width="78" height="38" rx="8" fill="color-mix(in oklab, var(--pt-gold,#cf9433) 16%, var(--sl-color-bg-sidebar))" stroke="var(--pt-gold,#cf9433)"/>
  <text x="525" y="126" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="12.5">.patterc</text>
  <!-- bundle -> runtimes -->
  <text x="580" y="112" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10" style="text-transform:uppercase" letter-spacing="1">load</text>
  <path d="M564 122 H594" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-arrow)"/>
  <!-- Patterplay runtimes -->
  <rect x="596" y="76" width="134" height="100" rx="10" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <rect x="596" y="76" width="134" height="3" rx="1.5" fill="var(--pt-ember,#d2603e)"/>
  <text x="663" y="97" text-anchor="middle" fill="var(--sl-color-white)" font-size="12.5">Patterplay</text>
  <g font-size="11.5" text-anchor="middle" fill="var(--sl-color-white)">
    <rect x="604" y="106" width="58" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="633" y="123">JS / Web</text>
    <rect x="666" y="106" width="58" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="695" y="123">Unity</text>
    <rect x="604" y="138" width="58" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="633" y="155">Unreal</text>
    <rect x="666" y="138" width="58" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="695" y="155">Godot</text>
  </g>
  <text x="663" y="196" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">identical in every engine</text>
  <!-- shared-core band -->
  <rect x="14" y="214" width="716" height="34" rx="8" fill="none" stroke="var(--sl-color-gray-5)" stroke-dasharray="4 4"/>
  <text x="372" y="235" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">One shared core underneath, so a story plays the same way in every engine.</text>
</svg>

1. **Writers author in [Patterpad](/patterpad/overview/).** The project is just a folder
   of plain-text [files](/format/overview/) (scenes, strings, and their notes) that live
   in your version control alongside the rest of the game.
2. **A build compiles the project to one `.patterc` bundle**: a single file, the only thing you
   ship. The [`patter` CLI](/cli/) does this from the terminal (handy for automation), and
   Patterpad's own Build menu runs the exact same compile.
3. **A [Patterplay](/play/overview/) runtime loads the bundle and plays it.** There's one
   for each engine (JavaScript, Unity, Unreal, Godot), and they all play a story the same way, so
   what your writers saw in Patterpad is what your players get.

Because Patterpad and the CLI share one engine underneath, what you write, what you automate, and
what finally runs in your game never drift apart.

## The components

| Component | Who it's for | What it is |
|---|---|---|
| **Patterpad** | Writers + the project lead | The desktop editor: a screenplay-style writing surface, live validation, an in-app play window, review/comments, status tracking, localisation, and all project settings. [Tour it →](/patterpad/overview/) |
| **The Patter format** | Tooling authors + the curious | The on-disk project (text shards in your VCS) and the compiled `.patterc` bundle you ship. [Read it →](/format/overview/) |
| **Patterplay** | Game developers | The runtime family: one native player per engine (JS, Unity, Unreal, Godot), each verified against the shared corpus. [Integrate it →](/play/overview/) |
| **The `patter` CLI** | Developers + CI | The same operations the editor runs, from the terminal: validate, format, compile, play, report, localisation export/import. [Automate it →](/cli/) |

Under the hood, all of these sit on one shared core (the model, the compiler, and a single
operations layer), which is *why* they can't drift, but you never have to think about those
internals to use Patter.

## Find your track

The docs are organised by what you're trying to do:

- **You write the story.** Live in [Writing in Patterpad](/patterpad/overview/).
- **You set the project up for the writers.** See [Setting up a project](/setup/overview/):
  properties, game data, cast, languages, version control, and building.
- **You run the narrative effort.** See [Running the project](/production/overview/):
  tracking progress, reviewing, and handing work to producers, translators, and voice actors.
- **You put the story in a game.** See [Playing in your game](/play/overview/): a
  quickstart for each engine plus the runtime API.

Everyone shares one vocabulary: the [Core concepts](/concepts/) primer.
