# @patterkit/dialect

Patter's configuration of the [`@wildwinter/expr`](https://www.npmjs.com/package/@wildwinter/expr)
expression language: the scopes and built-in functions that conditions and effects use, plus the helpers for
`{@name}` placeholders in dialogue text. The compiler uses it to check expressions and the runtime uses it
to evaluate them, so both agree by construction.

Most people won't need to install this directly. To play Patter dialogue in a game or web page, use
[`@patterkit/runtime`](https://www.npmjs.com/package/@patterkit/runtime); to work with Patter projects from
a terminal or a build script, use [`@patterkit/cli`](https://www.npmjs.com/package/@patterkit/cli).

## What's in it

- **The dialect** (`patterDialect`): the `@patter` scope (the default, so a bare `@name` means
  `@patter.name`) and the `@scene` scope, and the built-in functions `random`, `check_flags`, `set_flags`,
  `visits`, `seen`, `patter_visits`, and `patter_seen`.
- **Scopes from the game**: `dialectWithForeignScopes` and `hostScopesToSpec` add the scopes a game
  declares itself, such as `@world`, alongside Patter's own.
- **An expression schema** (`buildSchema`) built from a project's property declarations, for checking
  expressions before anything runs.
- **Placeholders**: `extractSlots`, `interpolate`, and `renderSlotValue` find and fill `{@name}`
  placeholders, and `stripCaptions` removes caption cues for closed captions.

The expressions themselves are described in [Choices and
logic](https://patterkit.dev/format/choices-and-logic/).

```sh
npm install @patterkit/dialect
```

## Part of Patter

[Patter](https://patterkit.dev/) is a branching dialogue format with its own editor (Patterpad), command line
tool (`patter`), and runtimes for JavaScript, Unity, Unreal, and Godot. This package is one layer of the
JavaScript tooling, and the other `@patterkit` packages build on it. [How it fits
together](https://patterkit.dev/architecture/) shows where each piece sits, and the source is in the
[patter repository](https://github.com/patterkit/patter).

## Licence

MIT
