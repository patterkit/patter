# Patter

[![CI](https://github.com/patterkit/patter/actions/workflows/ci.yml/badge.svg)](https://github.com/patterkit/patter/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-patterkit.dev-2f6f66)](https://patterkit.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Patter** is an open toolkit for authoring and running spoken dialogue in games -
performance-first and localisation-first. Writers work in **Patterpad**, a calm
desktop editor; a compiler turns the plain files on disk into a small runtime
bundle that **Patterplay** runtimes play back inside your game - the same story
on JavaScript, Unity, Unreal, and Godot. Think "Ink, but spoken-line-first":
every line carries a stable id so VO takes, recording status, and translations
all hang off it.

Everything here is MIT-licensed. **Documentation lives at
[patterkit.dev](https://patterkit.dev)** - a guided tour, per-role guides for
writers / producers / game programmers, and the format reference.

## What's in this repository

| Area | What it is |
|------|------------|
| [`packages/`](packages) | The `@patterkit/*` npm workspaces (see below) - model, compiler, runtime, ops, CLI, the Patterpad app. |
| [`ports/`](ports) | The native Patterplay runtimes: Unity (C#), Unreal (C++), Godot (GDScript), each with a bundled demo and held to the shared test suite. |
| [`website/`](website) | The [patterkit.dev](https://patterkit.dev) documentation site (Astro + Starlight). |
| [`examples/`](examples) | Example projects (the *Interactive Tour*), a browser player, and the JS drop-in demo. |
| [`branding/`](branding) | The PatterKit marks, wordmarks, and app icons. |

## Packages (`@patterkit/*`)

An npm-workspaces monorepo under `packages/`, layered bottom-up:

| Package | Role |
|---------|------|
| **`model`** | The data-model types (scene / block / group / snippet / beat / jump, project, locale, authoring). The shape source-of-truth. |
| **`core`** | Stable id generation, readable-handle computation, canonical (de)serialisation, the structural validator. |
| **`dialect`** | The Patter dialect for the expression engine (scopes, built-in functions), an expression-schema builder, and the inline `{@ref}` interpolation helpers. |
| **`compiler`** | Compile + validate condition/effect expressions and export source to the runtime bundle. |
| **`runtime`** | The JS Patterplay runtime: load a bundle and play dialogue - flows, selectors, choices, jumps, effects, properties, saves. |
| **`ops`** | The shared operations layer - every project operation (load, validate, export, format, play, report, pack, ...) as a pure function. The CLI and Patterpad are thin front-ends over this. |
| **`cli`** | The `patter` command. See [packages/cli/README.md](packages/cli/README.md). |
| **`patterpad`** | The Patterpad desktop editor (Electron), with `patterpad-surface` as its editing surface. |
| **`play-helpers`** | Small browser-side helpers for the JS runtime (save slots, audio resolution). |
| **`conformance`** | A language-agnostic JSON corpus (expression + playthrough cases) that all four runtimes must pass - the cross-language parity contract. |

The expression engine and version-control awareness live in sibling repos and
are consumed as published packages: **`@wildwinter/expr`** + **`scoperegistry`**
(the language) and **`@wildwinter/simple-vc-lib`** (git / Perforce / Plastic /
SVN reads + writes).

## File types

| Extension | Role | Source of truth? |
|-----------|------|------------------|
| `.patter` | The **project** - a folder of shards (a macOS package; a plain folder elsewhere) | yes (it *is* the source tree) |
| `.patterproj` | Project settings manifest (inside the `.patter`) | yes |
| `.patterflow` | One flow / scene (the structural tree) | yes |
| `.patterloc` | Localised strings, per scene per locale | yes |
| `.patterx` | Authoring / production metadata (status, comments, estimates) | yes |
| `.patterc` | Compiled runtime bundle (`export` output, strict JSON) | generated |
| `.patterpack` | Packed portable send document (`pack` output, binary zip) | generated |

Source files are UTF-8 + LF JSON5; the per-scene sharding plus canonical,
trailing-comma serialisation is what makes them merge cleanly across a team.

## Quick start

```sh
npm install            # install workspace + sibling-resolved deps
npm test               # run the full suite (vitest)
npm run typecheck      # tsc across the workspace

# the CLI (from a build, or the standalone binary):
node packages/cli/dist/cli.js init my-game --name "My Game"
node packages/cli/dist/cli.js play my-game
node packages/cli/dist/cli.js export my-game        # -> dist/my-game.patterc
```

`@wildwinter/expr` and `scoperegistry` are resolved from a sibling `../expr`
checkout for development (tsconfig paths + vitest aliases) and from the published
packages otherwise.

## Examples

- **`examples/projects/tour.patter`** - the *Patter Interactive Tour*: a story
  that teaches the format by playing it. Bundled as the demo in every runtime.
- **`examples/player`** - a tiny framework-free browser player for compiled
  `.patterc` bundles.
- **`examples/drop-in`** - the `patterplay.min.js` script-tag drop-in.
- **`examples/tour-web`** - the tour as a styled web page (the JS demo zip).

## Documentation

- [patterkit.dev](https://patterkit.dev) - the full documentation site
  (also in this repo under [`website/`](website)).
- [The format specification](https://patterkit.dev/specification/) and the
  [conformance corpus](packages/conformance) - the parity contract every
  runtime is held to.

## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
