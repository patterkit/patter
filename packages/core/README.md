# @patterkit/core

The low-level building blocks shared by Patter's editor, command line tool, and CI: ids, readable handles,
reading and writing the source files, and the structural validator.

Most people won't need to install this directly. To play Patter dialogue in a game or web page, use
[`@patterkit/runtime`](https://www.npmjs.com/package/@patterkit/runtime); to work with Patter projects from
a terminal or a build script, use [`@patterkit/cli`](https://www.npmjs.com/package/@patterkit/cli).

## What's in it

- **Ids and handles**: `newId` for stable node ids, and `slug`, `hash4`, and `hash32` for the readable
  handles and content hashes built from them.
- **Reading and writing source files**: `parseSource` and `canonicalStringify`, which write a project's
  files in one canonical form so version control shows only real changes.
- **The structural validator**: `validateProject` checks a project and its scenes hang together (ids,
  references, and structure) and returns a list of issues.
- **Scene scaffolding**: `planProject` and `planScene` plan a stub project or scene that another tool can
  hand to a writer.

```sh
npm install @patterkit/core
```

## Part of Patter

[Patter](https://patterkit.dev/) is a branching dialogue format with its own editor (Patterpad), command line
tool (`patter`), and runtimes for JavaScript, Unity, Unreal, and Godot. This package is one layer of the
JavaScript tooling, and the other `@patterkit` packages build on it. [How it fits
together](https://patterkit.dev/architecture/) shows where each piece sits, and the source is in the
[patter repository](https://github.com/patterkit/patter).

## Licence

MIT
