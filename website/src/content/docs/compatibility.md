---
title: Compatibility & conformance
description: How Patter guarantees the same story plays identically on every engine, one bundle schema as the contract, and a shared test suite every runtime must pass, case by case.
sidebar:
  label: Compatibility & conformance
---

"Write once, play everywhere" is only worth anything if it's actually *true*. Patter
backs it up with one versioned contract and a shared test suite every runtime has to
pass, so parity is something you can check, not just hope for.

<svg viewBox="0 0 760 288" role="img" aria-labelledby="pk-compat-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-compat-title">One .patterc bundle loads into each Patterplay runtime (JavaScript, Unity, Unreal, Godot); every runtime is checked against one shared corpus.json on each release, so a story behaves the same wherever it runs.</title>
  <defs>
    <marker id="pk-c-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker>
  </defs>
  <!-- bundle -->
  <rect x="306" y="16" width="148" height="44" rx="8" fill="color-mix(in oklab, var(--pt-gold,#cf9433) 14%, var(--sl-color-bg-sidebar))" stroke="var(--pt-gold,#cf9433)"/>
  <text x="380" y="37" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="13">.patterc</text>
  <text x="380" y="52" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">one schema: patter/bundle@N</text>
  <!-- bundle -> runtimes: fan from one point -->
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M380 60 V84 H130 V102" marker-end="url(#pk-c-arrow)"/>
    <path d="M380 60 V84 H290 V102" marker-end="url(#pk-c-arrow)"/>
    <path d="M380 60 V84 H450 V102" marker-end="url(#pk-c-arrow)"/>
    <path d="M380 60 V84 H610 V102" marker-end="url(#pk-c-arrow)"/>
  </g>
  <!-- runtimes -->
  <g font-size="12.5" text-anchor="middle" fill="var(--sl-color-white)">
    <rect x="60" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="60" y="104" width="140" height="3" rx="1.5" fill="var(--pt-ember,#d2603e)"/><text x="130" y="129">JS / Web</text>
    <rect x="220" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="220" y="104" width="140" height="3" rx="1.5" fill="var(--pt-ember,#d2603e)"/><text x="290" y="129">Unity</text>
    <rect x="380" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="380" y="104" width="140" height="3" rx="1.5" fill="var(--pt-ember,#d2603e)"/><text x="450" y="129">Unreal</text>
    <rect x="540" y="104" width="140" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><rect x="540" y="104" width="140" height="3" rx="1.5" fill="var(--pt-ember,#d2603e)"/><text x="610" y="129">Godot</text>
  </g>
  <!-- runtimes -> corpus: converge to one point, one arrow in -->
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M130 144 V172 H380"/>
    <path d="M290 144 V172 H380"/>
    <path d="M450 144 V172 H380"/>
    <path d="M610 144 V172 H380"/>
    <path d="M380 172 V194" marker-end="url(#pk-c-arrow)"/>
  </g>
  <!-- corpus -->
  <rect x="230" y="196" width="300" height="46" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--pt-teal-ink,#214f4b)"/>
  <rect x="230" y="196" width="300" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="380" y="217" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="12.5">corpus.json</text>
  <text x="380" y="233" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">the shared contract, checked on every release</text>
  <text x="380" y="270" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">The same language-neutral cases, pinned so a conforming runtime reproduces them exactly.</text>
</svg>

## The bundle schema is the contract

A compiled bundle declares a **schema version** (`patter/bundle@N`). A runtime plays any bundle
whose schema it supports. The schema is the one version that cuts across everything: bumping it
is the only thing that forces every runtime to update together. Everything else (each runtime's
own features, the editor, the CLI) versions on its own.

| Runtime | Artifact | Status |
|---|---|---|
| **Patterplay JS** | `@patterkit/runtime` (+ `patterplay.min.js`) | Available: corpus-verified |
| **Patter CLI** | `@patterkit/cli` | Available: corpus-verified |
| **Patterplay Unity** | GitHub Release (UPM) | Available: corpus-verified |
| **Patterplay Unreal** | GitHub Release (plugin) | Available: corpus-verified |
| **Patterplay Godot** | GitHub Release (addon) | Available: corpus-verified |

## The shared test suite

Every one of the four runtimes (JS, Unity, Unreal, Godot) has to pass the same set of
shared tests: a single, language-neutral `corpus.json` of hand-written cases that pin down the
exact behaviour a conforming engine must reproduce. It covers:

- **Expressions**: the evaluator, the Patter dialect (`random`, `flags`, `seen`, `visits`, …),
  and the seeded random-number generator, giving identical results on every engine.
- **Playthroughs**: scenes, blocks, groups, selectors, sticky/fallback options, call/return,
  conditions and effects, visit counts, `{@ref}` interpolation, and locale + character-name
  resolution (including the `<Untranslated: {id}>` fallback).
- **Scripted operations**: save/load round-trips, multiple flows, reset.
- **Game Data**: filling in defaults as values are read.

Each port ships a small **test host** that replays the same `corpus.json` in its own language and
checks it gets identical results. **Every port passes the full set of tests**: the JavaScript
reference, the C# (Unity) port on .NET, the C++ (Unreal) port under clang, and the GDScript
(Godot) port on Godot 4.7, matching down to the random draws.

## Why this matters

- **For you:** you ship on one engine, and this is what makes **your** engine trustworthy. It
  plays the story exactly as Patterpad's preview and the reference runtime do, the same choices,
  conditions, saves, right down to the random draws. What your writers saw in the editor is what
  your players get: no "works in the editor, behaves differently on my engine" gap to chase.
- **For a new engine:** adding a runtime is "build the engine, run the tests." If they pass,
  it's conformant. The test suite is published as a versioned release asset, so a port author has
  an exact target to hit.

It's not "should match." It's checked, case by case, and re-run on every release.

→ Back to [Playing in your game](/play/overview/).
