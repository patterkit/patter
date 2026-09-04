# Releasing

One repo, several deliverables, each on its own cadence. The **npm packages** are
driven by Changesets; everything else is tag-triggered.

## Before you start: `npm run release:status`

```sh
npm run release:status
```

One read-only summary of every train: each published package's repo version against the registry,
Patterpad's version and whether it is tagged, unpushed commits, pending changesets, an open
"Version Packages" PR, and the last few pipeline runs. Run it before and after anything below.

It queries npm with `--prefer-online` deliberately. **npm caches package metadata, so for a few
minutes after a publish a plain `npm view` reports the version you just replaced.** That has twice
made a successful publish look like a failed one. If you check by hand, use `--prefer-online`.

## The usual one: `npm run ship:npm`

**Committed some library work? This is the command.** From a clean tree it pushes,
waits for the bot to open the Version Packages PR, shows exactly what it would
publish, asks once, merges, and waits until the registry actually serves the new
versions.

```sh
npm run ship:npm               # push -> wait -> show -> ask -> merge -> verify
# Cut any runtime release (release:play) BEFORE this: every push to main makes the bot
# re-version the PR, and ship:npm follows the moving head rather than merging past it.
npm run ship:npm -- --dry-run  # plan only: pushes nothing, merges nothing
npm run ship:npm -- --yes      # no prompt
```

It does NOT commit, and refuses a dirty tree while listing what is still loose: a
script that stages files and invents a message is deciding what your change was.
So the whole cadence for ordinary work is two steps, one of them yours:

```sh
git commit ...                 # your work, your words, explicit paths
npm run ship:npm               # everything after that
```

If it says no changeset is pending, stop and read that sentence: a change to a
published package that ships without one publishes nothing at all.

## Publishing a PR that is already open: `npm run release:npm`

The back half on its own, for when the push already happened and a "Version
Packages" PR is sitting open:

```sh
npm run release:npm             # shows the bumps, asks, merges, waits, verifies
npm run release:npm -- --dry-run
npm run release:npm -- --yes
```

It reads the bumps off the PR diff, asks once (npm versions cannot be
unpublished), merges, then polls the registry with `--prefer-online` until the new
versions are actually served. With no PR open it says so and exits 0.

**Merging with YOUR credentials is load-bearing, which is why this is a local
script and not a workflow step.** A push made with `GITHUB_TOKEN` does not trigger
further workflow runs, so a pipeline that merged its own Version Packages PR would
land the bumped manifests on main and never publish them.

With no PR open it says which of the three states you are in, because "nothing to
publish" reads like "you are done" and usually means "wait": unpushed commits, or
changesets on main with the workflow still running, or genuinely nothing pending.

`ship:npm` and `ship:cli` are the whole-chain versions of the same pipe: `ship:npm`
for ordinary library work that brings its own changeset, `ship:cli` when there is no
changeset yet and the standalone binaries need tagging afterwards. All three share
`scripts/lib/version-pr.mjs`.

## When the Release run fails right after a workflow edit

The Changesets bot pushes `changeset-release/main` with the workflow token, and GitHub refuses any
push from that token that creates or changes a file under `.github/workflows/`. That is fine while
the branch exists (the bot's push only adds its version commit), but the branch is deleted every time
a Version Packages PR merges. So: edit a workflow on main while no Version Packages PR is open, and
the next Release run fails at "Create Version PR or publish to npm" with
`refusing to allow a GitHub App to create or update workflow ... without workflows permission`
(2026-09-04, play-js.yml). Recovery is one push from a person, then a re-run:

```sh
git push origin main:refs/heads/changeset-release/main   # the branch now exists at main's tip
```

The bot's next push moves that ref by its own commit alone, which the token may do.

## The changeset guard

A push that moves a published package's source with no changeset covering it is refused, by a
pre-push hook (`scripts/git-hooks/pre-push`) and again by CI on `main`.

Without one, `changeset publish` has nothing to do: the workflow goes green in under a minute having
published nothing, and the registry keeps serving one build under a version number the repo has
since given to another. Nothing goes red, because doing nothing is a legitimate outcome.

```sh
npm run changeset             # the fix, nearly always
npm run changeset -- --empty  # a comment or a pure refactor that genuinely ships nothing
npm run release:guard         # run the check by hand
git push --no-verify          # bypass, if you are certain
```

`@patterkit/runtime` is the exception in both directions: it is versioned by `npm run bump:play`, so
changing it needs no changeset, and a changeset that NAMES it is an error the guard reports.

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
> `packages/runtime`, something went wrong. Its dependency on `@patterkit/model` is the wide
> range `>=0.4.0 <1.0.0` rather than a caret, so a model MINOR does not cascade-bump it on its
> own (a caret let that happen twice, on the Version Packages PRs 42 and 50, unseen because
> bot-PR CI never ran; now that it does, the lockstep check would fail that PR and `ship:npm`
> would stall). Its other internal deps are caret ranges, which patch-bumps stay inside.

1. With each change touching a published package, add a changeset:
   ```sh
   npm run changeset
   ```
2. On merge to `main`, the **Release** workflow opens a "Version Packages" PR that
   bumps the affected packages, fixes their internal dependency ranges, and writes
   CHANGELOGs.
3. Merging that PR publishes the bumped packages to npm (with provenance) and tags
   them. `@patterkit/play-helpers` builds and carries the `patterplay.min.js` drop-in (runtime +
   helpers under one global) for unpkg/jsDelivr and the play-js release; the runtime alone is the library.

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

A CLI release is really two releases: the npm package (Changesets) and the standalone executables
(a `cli-v*` tag). The binaries take their version from the manifest the npm side bumps, **so the npm
half must land first** - tag early and you ship binaries labelled with one version and built from
another.

```sh
npm run ship:cli -- patch      # the whole chain, with one confirmation before it publishes
npm run ship:cli -- minor --yes
npm run ship:cli -- patch --dry-run
```

`ship:cli` writes the changeset, commits, pushes, waits for the "Version Packages" PR, **stops and
asks** (merging publishes to npm, and npm versions cannot be unpublished), merges, waits for the
registry to actually serve the new version, pulls, then tags `cli-v<ver>`. `--yes` skips the prompt.

The two halves by hand, if you would rather:

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

**Before a Godot release, run the export check.** `ports/godot/test/export_check.sh` exports a
project and runs the resulting pack. Everything else in `ports/godot/test` runs inside the editor,
where a bundle is on disk whatever the addon does to it, so an editor-only gate cannot see a build
that ships the wrong thing. That is how #45 reached users. It needs Godot plus export templates
installed, and skips cleanly without them.

**Before an Unreal release, build the plugin against a real engine.** The tag pipeline gates on the
clang TestHost, which compiles the std-only core and nothing UE-facing: not `PatterBundleLoader.cpp`,
not the UObject wrappers, not the editor module. Since the port ships source-only, code that does not
compile can reach a release (it did, on 2026-08-19). One command, with UE installed:

```sh
<UE>/Engine/Build/BatchFiles/Mac/Build.sh PatterplayDemoEditor Mac Development \
  -project="$PWD/ports/unreal/PatterplayDemo/PatterplayDemo.uproject"
```

Then run `Patterplay.Smoke` from the editor's Session Frontend (Tools > Session Frontend >
Automation), which drives the JSON loader, the UObject wrappers and the bundle description.


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
