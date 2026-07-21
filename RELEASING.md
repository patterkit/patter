# Releasing

One repo, several deliverables, each on its own cadence. The **npm packages** are
driven by Changesets; everything else is tag-triggered.

## Tag scheme

CI keys each pipeline off a tag prefix:

| Prefix | Deliverable | Pipeline | Driven by |
| --- | --- | --- | --- |
| `@patterkit/<pkg>@<ver>` | the npm packages | `.github/workflows/release.yml` | **Changesets** (auto-tagged on publish) |
| `bundle-schema-v*` | the conformance corpus (`corpus.json`) | `.github/workflows/corpus.yml` | manual tag |
| `v*` (bare; Patterpad's alone) | the Patterpad desktop app | `.github/workflows/patterpad.yml` | manual tag |
| `cli-v*` | standalone `patter` CLI binaries | `.github/workflows/cli.yml` | manual tag |
| `play-js-v*` / `play-unity-v*` / `play-unreal-v*` / `play-godot-v*` | the Patterplay **runtime set** (JS drop-in + web demo / the three engine plugins), versioned in lockstep | `.github/workflows/play-js.yml` / `play-unity.yml` / `play-unreal.yml` / `play-godot.yml` | `npm run bump:play`, then manual tags |

Changesets gives the **npm packages** their own per-package tags (including
`@patterkit/cli`) - with one exception: **`@patterkit/runtime` is versioned by
`bump:play`**, as the JS member of the runtime set (see below). The `cli-v*` tag is a
*separate* deliverable: the **non-npm** standalone CLI executables, for users who don't
want Node.

## npm packages (Changesets)

Published: `@patterkit/runtime`, `@patterkit/play-helpers`, `@patterkit/cli`,
`@patterkit/model`, `@patterkit/core`, `@patterkit/dialect`, `@patterkit/compiler`,
`@patterkit/ops`. (`conformance`, `patterpad`, `patterpad-surface` are `private` and
never published.)

> **Exception: `@patterkit/runtime` is versioned by `npm run bump:play`, never by a
> changeset.** It is the JS member of the lockstep runtime set (see *Patterplay runtimes*
> below). `changeset publish` still publishes it (it publishes any public package whose
> local version is ahead of the registry), but its version comes from `bump:play` - so do
> not add a changeset that names it, and if a "Version Packages" PR touches
> `packages/runtime`, something went wrong. Its internal deps are caret ranges so
> dependency patch-bumps don't cascade into it.

1. With each change touching a published package, add a changeset:
   ```sh
   npm run changeset
   ```
2. On merge to `main`, the **Release** workflow opens a "Version Packages" PR that
   bumps the affected packages, fixes their internal dependency ranges, and writes
   CHANGELOGs.
3. Merging that PR publishes the bumped packages to npm (with provenance) and tags
   them. `@patterkit/runtime` carries the `patterplay.min.js` drop-in for unpkg/jsDelivr.

**No npm secret is needed.** Publishing authenticates with npm **trusted publishing
(OIDC)**: each `@patterkit` package trusts this repo + `.github/workflows/release.yml` on
npmjs.com, so no token is stored anywhere and provenance is attested automatically. The
job needs `id-token: write` and an OIDC-aware npm (>= 11.5.1 - it is pinned to the 11.x
line because npm 12.0.0 ships a broken provenance path, npm/cli#9722). `GITHUB_TOKEN` is
provided automatically. Adding a package to the scope means registering it as a trusted
publisher on npmjs.com first, or its publish step will fail to authenticate.

Publish locally (fallback) with `npm run release` after the version PR is merged.

## Conformance corpus

```sh
git tag bundle-schema-v1 && git push origin bundle-schema-v1
```

The **Corpus release** workflow verifies the corpus regenerates byte-identical and
passes, then attaches `corpus.json` to the GitHub Release - the stable asset the
native port test harnesses pull.

## Patterpad desktop app

```sh
# 1. write the changelog: fill packages/patterpad/CHANGELOG.md's "## [Unreleased]" section
# 2. one command does the rest (bump + commit + tag v1.0.0 + push):
npm run release:pad -- 1.0.0
```

(`npm run bump:pad -- 1.0.0` remains for a look-before-you-leap bump, followed by the
manual commit/tag/push. `scripts/release.mjs` guards: on main, clean tree, up to date,
tag free; it pushes tags one per push - GitHub drops all push events when more than
three tags arrive at once.)

The workflow refuses a tag whose version does not match `packages/patterpad/package.json`
and a dated CHANGELOG section, so `bump:pad` is the one route to a release (the same
contract as `bump:play` for the runtimes). Like every other deliverable it publishes
straight from CI: the release is staged as a draft while the OS matrix uploads, and a
final job flips it live once all three builds succeeded (a half-built release is never
visible).

The **Patterpad release** workflow builds + signs Patterpad on mac/win/linux and
publishes the installers (dmg/zip, nsis, AppImage) plus the electron-updater feeds to
the GitHub Release; the app self-updates from there. macOS signing/notarization needs
these secrets (see `packages/patterpad/RELEASE.md`): `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Windows is intentionally
unsigned; Linux/Windows builds need no signing secrets.

## Standalone CLI + JS drop-in

```sh
npm run release:cli            # tags cli-v<ver> from @patterkit/cli's package.json
npm run release:cli -- 1.0.0   # or an explicit version
```

The **CLI release** workflow builds one self-contained `patter` executable per
platform (no Node needed) with Bun `--compile`, and attaches them to the GitHub
Release - the assets the website's Download page lists live. (The JS runtime -
`patterplay-js-<ver>.zip` + the loose `patterplay.min.js` - ships on `play-js-v*` tags;
see below.) Two jobs: macOS builds + Developer-ID-signs `patter-macos-arm64` and
`patter-macos-x64` (Bun cross-compiles both, `codesign` on the runner); Linux
cross-compiles `patter-linux-x64`, `patter-linux-arm64`, and `patter-windows-x64.exe`
(Windows ships unsigned by policy → SmartScreen) and builds the drop-in. macOS signing
reuses `CSC_LINK` + `CSC_KEY_PASSWORD` (imported into a runner keychain); absent those,
the binaries are still produced, ad-hoc signed. We codesign but **don't notarize** the
CLI. Build locally with `npm run -w @patterkit/cli build:standalone` (host target) or
`…:mac` / `…:others`.

## Patterplay runtimes (JS + Unity + Unreal + Godot)

The four runtimes are **one deliverable set, versioned in lockstep** (one version number =
one runtime behaviour; the JS runtime is a member of the set, not a separate thing), and
each ships its own `CHANGELOG.md`. One script is the release route:

```sh
# 1. write user-facing notes under "## [Unreleased]" in each runtime's CHANGELOG.md, then:
npm run release:play -- 1.0.0
# (bump + commit + the four play-*-v tags, pushed ONE per push - never `git push --tags`
#  here: GitHub drops all push events when more than three tags arrive in a single push.
#  `npm run bump:play -- 1.0.0` remains for a bump you want to review before committing.)
```

`scripts/bump-play-version.mjs` writes the version into every runtime manifest (JS
`packages/runtime/package.json` + the in-repo pins on it, Unity `package.json`, the
Unreal `.uplugin`, Godot `plugin.cfg`) and stamps the changelog sections with today's
date, all-or-nothing. Each pipeline **refuses a tag whose version does not match the
manifests / changelog**, so a release cannot ship out of sync.

Two CI checks hold the set together on every PR, long before a tag exists:
`scripts/check-runtime-lockstep.mjs` (all four manifests carry the same version) and
`scripts/check-runtime-api-parity.mjs` (all four expose the same public API, plus the
Unreal Blueprint wrapper as a fifth surface). The conformance corpus proves the runtimes
**agree** about what they do; the parity check proves they all **have** it, which the
corpus cannot - it only pins the calls a case actually makes. Add every new public runtime
member to that manifest in the same commit that adds it.

The **`play-js-v*`** pipeline gates on the full JS test suite (which replays the
conformance corpus through the reference runtime), then attaches
**`patterplay-js-<ver>.zip`** to the GitHub Release - the JS runtime as a plain download,
symmetric with the three plugin zips (`patterplay.min.js` + the module builds + README +
CHANGELOG + two bundled demos; no npm needed) - plus a loose `patterplay.min.js` for a
one-file grab. npm is a parallel channel, not the primary one: `@patterkit/runtime`
carries the same version and the next Changesets release run on `main` publishes it (no
extra step - it publishes any public package whose version is ahead of the registry).

Each engine-plugin pipeline also **gates on the conformance corpus before packaging**: it
runs that port's TestHost (Unity = the dotnet console replaying `Runtime/*.cs`; Unreal = the clang
build of the std-only engine; Godot = a headless Godot running the SceneTree
`test_corpus.gd`), and only on `ALL PASS` zips the package and attaches it to the GitHub
Release - `patterplay-<engine>-<ver>.zip`. Users install Unity/Godot by dropping the
folder into `Packages/` / `addons/` (or by git-URL); the Unreal zip is two sibling folders,
the runtime plugin plus a ready-to-open **PatterplayDemo sample project** (its `.uproject`
finds the plugin beside it via `AdditionalPluginDirectories`). The zips carry only what
users need (plugin + demos + README + CHANGELOG); TestHosts and corpus material never ship. No engine
install is needed for the Unity/Unreal gates (both run on a plain ubuntu runner); the
Godot job downloads Godot `4.3-stable` headless. No secrets beyond the default
`GITHUB_TOKEN`.

## CI note

`tsconfig.json` and `vitest.config.ts` alias `@wildwinter/expr` to a sibling `../expr`
checkout (dev tests against its source). The workflows reproduce this by checking out
`wildwinter/expr` alongside `patter`; if that repo is private, add a token to those
checkout steps.
