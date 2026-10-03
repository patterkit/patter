# @patterkit/model

The TypeScript types that describe Patter's data: the shape every other `@patterkit` package agrees on.
Types only, with no behaviour.

Most people won't need to install this directly. To play Patter dialogue in a game or web page, use
[`@patterkit/runtime`](https://www.npmjs.com/package/@patterkit/runtime); to work with Patter projects from
a terminal or a build script, use [`@patterkit/cli`](https://www.npmjs.com/package/@patterkit/cli).

## What's in it

- **The source format**: scenes and their flow tree (blocks, groups, snippets, beats, and jumps), the
  project file, locale files, and the authoring file that holds comments, suggestions, and writing status.
- **The compiled bundle**: the `.patterc` a game loads, as written by the compiler and read by every runtime.
- **Shared helpers for addressing**: the game-facing ids (`gameIdify`, `isValidGameId`, `effectiveGameId`).

Conditions and effects are kept as source strings here; the expression language itself is
[`@wildwinter/expr`](https://www.npmjs.com/package/@wildwinter/expr). The format is described in
[the specification](https://patterkit.dev/specification/).

```sh
npm install @patterkit/model
```

## Part of Patter

[Patter](https://patterkit.dev/) is a branching dialogue format with its own editor (Patterpad), command line
tool (`patter`), and runtimes for JavaScript, Unity, Unreal, and Godot. This package is one layer of the
JavaScript tooling, and the other `@patterkit` packages build on it. [How it fits
together](https://patterkit.dev/architecture/) shows where each piece sits, and the source is in the
[patter repository](https://github.com/patterkit/patter).

## Licence

MIT
