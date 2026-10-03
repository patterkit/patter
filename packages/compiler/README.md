# @patterkit/compiler

Turns a Patter project's source files into the compiled bundle (`.patterc`) that every Patter runtime
plays, checking its conditions and effects on the way.

Most people won't need to install this directly. To play Patter dialogue in a game or web page, use
[`@patterkit/runtime`](https://www.npmjs.com/package/@patterkit/runtime); to work with Patter projects from
a terminal or a build script, use [`@patterkit/cli`](https://www.npmjs.com/package/@patterkit/cli).

## What's in it

- **Export**: `exportBundle` takes a loaded project, its scenes, and optionally its locales, and returns
  the bundle, with every expression compiled and every embedded string in place.
- **Expressions**: `compileExpression` compiles one condition or effect, and `validateConditions` and
  `validateInterpolation` check a project's expressions and `{@name}` placeholders against its declared
  properties, reporting each problem with where it is.
- **Scopes**: `projectScopes` and `externalGameScopes` work out which scopes a project can use, including
  the ones the game declares.

To build a bundle without writing code, use the `patter export` command in
[`@patterkit/cli`](https://www.npmjs.com/package/@patterkit/cli), or Patterpad's Publish menu.

```sh
npm install @patterkit/compiler
```

## Part of Patter

[Patter](https://patterkit.dev/) is a branching dialogue format with its own editor (Patterpad), command line
tool (`patter`), and runtimes for JavaScript, Unity, Unreal, and Godot. This package is one layer of the
JavaScript tooling, and the other `@patterkit` packages build on it. [How it fits
together](https://patterkit.dev/architecture/) shows where each piece sits, and the source is in the
[patter repository](https://github.com/patterkit/patter).

## Licence

MIT
