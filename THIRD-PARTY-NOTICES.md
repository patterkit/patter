# Third-party notices

Patter is licensed under the MIT License (see [`LICENSE`](./LICENSE)). It ships with, or embeds,
the third-party components below. Each is used under its own licence, reproduced where required.

## Fonts (Patterpad, the readable-script PDF export, and the website)

The repository holds no font files. Every face is an npm dependency, fetched from its upstream package
when Patter is installed or built, and each package carries its own licence and copyright notice (which
ship in the packaged app's `node_modules`). All are under the SIL Open Font License 1.1.

- **Newsreader** (`@fontsource/newsreader`, `@fontsource-variable/newsreader` on the website):
  © The Newsreader Project Authors.
- **Inter** (`@fontsource/inter`): © The Inter Project Authors.
- **IBM Plex Mono** and **IBM Plex Sans** (`@ibm/plex-mono`, `@ibm/plex-sans`, IBM's own releases):
  © IBM Corp., with Reserved Font Name "Plex". Patter uses IBM's unmodified files rather than a third
  party's subset, because the OFL keeps a reserved name off modified versions.
- **Literata**, **Source Serif 4**, **Courier Prime** (`@fontsource/literata`, `@fontsource/source-serif-4`,
  `@fontsource/courier-prime`): Patterpad's other reading-font themes. © their project authors.
- **Noto Sans**, **Noto Sans Math**, **Noto Emoji** (`@fontsource/noto-sans`, `@fontsource/noto-sans-math`,
  `@fontsource/noto-emoji`): the PDF export's fallbacks for scripts, symbols, and emoji. © The Noto
  Project Authors / Google LLC.

A PDF the export writes embeds only the characters it uses; the OFL does not cover documents made with
a font.

## Notices inside the built apps and binaries

A bundle or a compiled binary keeps none of its libraries' licence files, so the builds carry them:

- **Patterpad** writes the licence and copyright notice of every library bundled into each part of the
  app to `out/licences/` (main, preload, renderer), with Patter's own `LICENSE` beside them, and the
  font licences to `out/fonts/`. Electron's licence and Chromium's notices ship in the app's resources
  under `licences/electron/`. Libraries left external ship in `node_modules` with their own files.
- **The standalone `patter` binaries** embed the same for everything compiled into them, and print it
  with `patter licences`.

The notices are collected at build time by `scripts/third-party-notices.mjs` (shared across the family
from expr's `tooling/`).

## Spell-check dictionaries (bundled with Patterpad)

- **en-US** and **en-GB Hunspell dictionaries**, derived from SCOWL (<http://wordlist.sourceforge.net>).
  Each dictionary's licence travels with it:
  [`packages/patterpad/resources/dictionaries/en-US/license`](./packages/patterpad/resources/dictionaries/en-US/license)
  and [`.../en-GB/license`](./packages/patterpad/resources/dictionaries/en-GB/license).

## Runtime ports (bundled with or required by the engine plugins)

- **Json.NET (Newtonsoft.Json)** - the Patterplay Unity package depends on Unity's
  `com.unity.nuget.newtonsoft-json` (3.2.1) for bundle and save parsing. MIT License,
  © James Newton-King. Full text: <https://github.com/JamesNK/Newtonsoft.Json/blob/master/LICENSE.md>.
  The library itself is delivered by the Unity Package Manager, not inside the Patterplay zip.

## Bundled npm dependencies

Patter and Patterpad build on the open-source packages below. All are MIT-licensed unless noted;
each package's licence ships in its `node_modules` entry and in the packaged app's resources.

- **PDFKit**, **docx**, **ExcelJS** — document export (MIT).
- **fontkit** — font subsetting for the PDF export (MIT).
- **ProseMirror** (`prosemirror-model` / `-view` / `-state` / `-transform` / `-history` / `-keymap` /
  `-commands`) — the Patterpad writing surface (MIT).
- **nspell** — the spell-check engine (MIT).
- **Electron**, **electron-vite**, **electron-builder**, **electron-updater** — the desktop app shell
  and packaging (MIT).
- **Astro** + **Starlight** + **Pagefind** — the documentation website (MIT).
- **@fontsource/\*** UI fonts (Newsreader, Literata, Source Serif, Inter) — SIL Open Font License 1.1.

This list covers the components redistributed in a build or embedded in the source. The complete,
resolved dependency tree (with every transitive licence) is in `package-lock.json`; run
`npx license-checker --summary` for a full machine-generated report.
