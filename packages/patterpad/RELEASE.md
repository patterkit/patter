# Building and releasing Patterpad

Patterpad is packaged with electron-builder. macOS builds are **code-signed + notarized**; Windows
builds are **not signed** (see the end-user note below).

## macOS - signed + notarized

electron-builder does this natively via the `build.mac` config (`hardenedRuntime: true`,
`gatekeeperAssess: false`, `notarize: true`) - no custom afterSign hook. It needs:

1. An Apple Developer account and a **Developer ID Application** certificate in your login keychain
   (or exported and pointed at via `CSC_LINK` / `CSC_KEY_PASSWORD`).
2. Notary credentials - an Apple ID + app-specific password + team id, or an App Store Connect API key.

Put them in `.env.local` (copy `.env.local.example`; it is gitignored). Then:

```sh
npm run dist:mac      # local signed + notarized build (dmg + zip) in ../../release
npm run publish:mac   # the same, and upload installers + the update feed to the GitHub Release
```

Notes:
- `notarize: true` is a **no-op without credentials**, so a plain `npm run dist:mac` on a dev machine
  with no certs still produces a working (unsigned) build - it just logs that signing/notarization were
  skipped. Signing only happens when the cert + creds are present.
- First notarization of a version is slow (Apple's notary service, a few minutes).
- The `zip` target is required by electron-updater's macOS self-update (the dmg is the human download).

## Windows - unsigned

We do not code-sign Windows (no EV certificate). The NSIS installer therefore trips SmartScreen on first
run. The **end-user workaround is documented in [`docs/installation.md`](../../docs/installation.md)**
("More info -> Run anyway"); make sure release notes link to it.

```sh
npm run dist:win      # unsigned NSIS installer in ../../release
```

## Linux - AppImage

```sh
npm run dist:linux    # AppImage in ../../release (electron-updater self-updates AppImage)
```

## Versioning

Patterpad is versioned by the bump script (the same contract as the runtimes' `bump:play`):

```sh
# 1. write the changelog: fill CHANGELOG.md's "## [Unreleased]" section
# 2. bump - writes package.json's version, dates the changelog, prints the tag command:
npm run bump:pad -- 1.0.0        # from the repo root
# 3. commit, then tag v1.0.0 and push
```

The release workflow refuses a tag whose version does not match `package.json` and a dated
CHANGELOG section, so the script is the one route to a release. electron-builder takes the
installer file names, the About-dialog version, and the updater-feed version from
`package.json`, so nothing else needs touching.

## Publishing + auto-update

`build.publish` targets the GitHub provider (`patterkit/patter`). A build with `--publish always`
uploads the installers plus the electron-updater feeds (`latest-mac.yml` / `latest.yml` /
`latest-linux.yml`) to the matching GitHub Release. Locally, `npm run publish:mac` does the mac side;
in CI the **Patterpad release** workflow (`.github/workflows/patterpad.yml`, triggered by a
`v*` tag; bare v* tags are Patterpad's alone - electron-builder and electron-updater only understand plain semver tags) builds + publishes all three OSes, with signing creds from Actions secrets instead
of `.env.local`.

The app self-updates from that feed via **electron-updater** (`src/main/updater.ts`): a background check
~10s after launch and every 6 hours, plus **Help ▸ Check for Updates…**. Before an install restart it
asks the renderer whether the scene is dirty and offers Save / Discard / Cancel, so "Restart Now" can
never drop unsaved work. Auto-update only runs in a packaged build (`app.isPackaged`), and needs the
signed mac build (Gatekeeper rejects unsigned updates).
