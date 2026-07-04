# Contributing to Patter

Thanks for your interest! Patter is young and moving quickly, so before building anything
substantial, please open an issue first - it may already be underway, or there may be a
design reason it looks the way it does.

## Getting set up

```sh
git clone https://github.com/patterkit/patter.git
cd patter
npm install
npm test               # the full suite, including the cross-runtime conformance corpus
npm run typecheck
```

That's it - a plain clone runs everything against the published `@wildwinter/expr`
expression-engine packages.

If you're working on the expression engine itself, clone
[wildwinter/expr](https://github.com/wildwinter/expr) as a **sibling** of this repo
(`../expr`); the tsconfig paths and vitest aliases automatically prefer its source when the
checkout exists.

### Running Patterpad from source

```sh
npm run test:pad       # launches the editor in dev mode (electron-vite)
```

### The website

```sh
cd website && npm install && npm run dev
```

## The shape of the repo

- `packages/` - the `@patterkit/*` workspaces, layered bottom-up (`model` → `core` →
  `dialect` → `compiler` → `runtime` → `ops` → `cli` / `patterpad`). See the README table.
- `ports/` - the native Patterplay runtimes (Unity C#, Unreal C++, Godot GDScript). Each must
  pass `packages/conformance/corpus.json`, the cross-language parity contract. If you change
  runtime behaviour, the corpus and all four runtimes move together.
- `website/` - the [patterkit.dev](https://patterkit.dev) docs (Astro + Starlight).

## House rules

- **Tests first-class.** New behaviour comes with tests; `npm test` must stay green. Runtime
  behaviour changes need corpus cases so all four runtimes stay in lockstep.
- **Match the local style.** Look at the file you're editing; keep its idiom, naming, and
  comment density.
- **Small PRs travel faster.** One change per PR, with a note on why.
- Changes to published `@patterkit/*` packages need a changeset (`npm run changeset`) -
  except `@patterkit/runtime` and Patterpad, which are versioned by `npm run bump:play` /
  `npm run bump:pad` (maintainers run these at release time).

## Releases (maintainers)

Tag-driven: `play-*-v*` ships the four runtimes in lockstep, `patterpad-v*` the editor,
`cli-v*` the standalone CLI, `corpus-v*` the conformance corpus. The bump scripts write the
manifests + changelogs and print the tag commands; the workflows refuse mismatched tags.

## License

MIT. By contributing, you agree your contributions are licensed under the same terms.
