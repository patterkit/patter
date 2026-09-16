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
`setProperties(engine, { "@hp": 10, "@scene.locked": false })`.

For debugging there's `createStateLogger(engine)`, which traces each step and diffs state over time
while you're working.
