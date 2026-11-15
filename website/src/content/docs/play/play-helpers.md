---
title: The play-helpers package
description: Add optional host-wiring helpers for save/load, property setters, and a state logger with @patterkit/play-helpers.
sidebar:
  label: Play-helpers package
---

[`@patterkit/play-helpers`](https://github.com/patterkit/patter/tree/main/packages/play-helpers) is an
optional companion for the JavaScript runtime that smooths common host wiring. None of it is required to
play, the core `Engine` does everything; these just save you a little boilerplate.

For save and load there's `saveState` / `loadState`, plus `serializeState` / `deserializeState` for a
string you can drop straight into `localStorage` or a file. See
[Save and load](/play/integration/#save-and-load).

For properties there's `getProperty`, `setProperty`, and a batched
`setProperties(engine, { "@hp": 10 })`. Pass a flow instead of the engine for `@scene` properties,
since each flow has its own: `setProperties(flow, { "@scene.locked": false })`.

For debugging there's `createStateLogger(engine)`, which traces each step and diffs state over time
while you're working.

The package has a few more helpers, each covered where you'd use it:

- `Runner`, which plays a flow a beat at a time and hands each beat to your game: [The runner](/play/runner/).
- `createAudioResolver`, which finds the voice clip for a line: [Audio](/play/audio/).
- `createDebugLink` and `applyLiveBundle`, for Patterpad's Live Link: [Live refresh and debug](/play/live-debug/).
- `createPropertyInspector`, an on-screen view of your properties while you work: [JavaScript](/play/javascript/).
