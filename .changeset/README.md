# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets) -
it versions and publishes the `@patterkit/*` **npm** packages (runtime, play-helpers,
cli, model, core, dialect, compiler, ops).

With every change that touches a published package, add a changeset:

```sh
npm run changeset
```

Pick the affected packages and the bump (patch / minor / major) and write a one-line
summary; this writes a small markdown file here. They accumulate on `main`; the
**Release** workflow opens a "Version Packages" PR that consumes them (bumping each
package, fixing internal dependency ranges, writing CHANGELOGs), and publishes to npm
when that PR merges.

Not covered here (own tag + CHANGELOG flow): **Patterpad** (`patterpad-v*`), the
**native ports** (`play-unity-v*` / `play-unreal-v*` / `play-godot-v*`), and the
**bundle schema / corpus** (`bundle-schema-v*`). See `RELEASING.md`.
