---
title: The play-helpers package
description: "@patterkit/play-helpers: optional host-wiring conveniences for save/load, property setters, and a state logger. None of it is required to play."
sidebar:
  label: Play-helpers package
---

[`@patterkit/play-helpers`](https://github.com/patterkit/patter/tree/main/packages/play-helpers) is an
optional companion for the JavaScript runtime that smooths common host wiring. None of it is required to
play, the core `Engine` does everything; these just save you a little boilerplate.

- **Save/load**: `saveState` / `loadState`, and `serializeState` / `deserializeState` for a string you
  can drop straight into `localStorage` or a file. See
  [Save and load](/play/integration/#save-and-load).
- **Property setters**: `getProperty`, `setProperty`, and a batched
  `setProperties(engine, { "@hp": 10, "@scene.locked": false })`.
- **A state logger**: `createStateLogger(engine)` to trace each step and diff state over time while
  you're debugging.
