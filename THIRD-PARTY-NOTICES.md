# Third-party notices

Patter is licensed under the MIT License (see [`LICENSE`](./LICENSE)). It ships with, or embeds,
the third-party components below. Each is used under its own licence, reproduced where required.

## Fonts (embedded in the readable-script PDF export)

- **DejaVu Sans** (Regular / Bold / Oblique / BoldOblique) — Bitstream Vera + Arev licence
  (permissive; DejaVu's own changes are public domain). Full text:
  [`packages/ops/fonts/DejaVu-LICENSE.txt`](./packages/ops/fonts/DejaVu-LICENSE.txt).
- **Noto Emoji** (monochrome) — © The Noto Project Authors, SIL Open Font License 1.1. Full text:
  [`packages/ops/fonts/OFL.txt`](./packages/ops/fonts/OFL.txt).

The font binaries are not stored in the repository; they are inlined (gzip + base64) into
`packages/ops/src/script-fonts.ts` by `packages/ops/scripts/gen-fonts-blob.mjs`.

## Spell-check dictionaries (bundled with Patterpad)

- **en-US** and **en-GB Hunspell dictionaries**, derived from SCOWL (<http://wordlist.sourceforge.net>).
  Each dictionary's licence travels with it:
  [`packages/patterpad/resources/dictionaries/en-US/license`](./packages/patterpad/resources/dictionaries/en-US/license)
  and [`.../en-GB/license`](./packages/patterpad/resources/dictionaries/en-GB/license).

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
