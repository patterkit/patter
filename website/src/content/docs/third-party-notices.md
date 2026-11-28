---
title: Third-party notices
description: What comes with Patter from other people, under their own terms, and which downloads include it.
sidebar:
  label: Third-party notices
---

Patter is under the [MIT licence](https://github.com/patterkit/patter/blob/main/LICENSE). Some of what comes with it is other people's work, under their own terms: those terms, not Patter's licence, cover it. This page lists each such thing, where it comes from, its licence, and which downloads include it.

What includes what:

- **Patterplay's engine runtimes** (the Unity package, the Unreal plugin, and the Godot addon) include only Patter's own code. The Unity package needs Unity's Json.NET package (`com.unity.nuget.newtonsoft-json`, MIT, © James Newton-King), which Unity's Package Manager fetches; it isn't in the download.
- **The npm packages** (`@patterkit/runtime`, `@patterkit/play-helpers`, the CLI, and the rest) include only Patter's own code. npm installs their dependencies, each with its own licence file.
- **Patterpad** includes Electron and Chromium, the libraries, the fonts, and the spell-check dictionaries below.
- **The standalone `patter` binaries** include the libraries compiled into them and the PDF export's fonts.

Every licence travels with the download that includes it. Patterpad keeps its libraries' in `licences/`, its fonts' in `fonts/`, the dictionaries' beside each dictionary, and Electron's and Chromium's (`LICENSE.electron.txt`, `LICENSES.chromium.html`) in the app's resources. A standalone binary prints all of its own with `patter licences`.

| What | From | Licence | Where |
|---|---|---|---|
| Electron, with Chromium | the Electron contributors and GitHub; the Chromium authors | MIT; Chromium's BSD-style licence and its components' own | Patterpad |
| ProseMirror, the writing surface | Marijn Haverbeke and contributors | MIT | Patterpad |
| PDFKit and fontkit, the PDF export | Devon Govett and contributors | MIT | Patterpad, the binaries |
| docx and ExcelJS, the Word and Excel exports | Dolan Miu; Guyon Roche | MIT | Patterpad, the binaries |
| JSZip | Stuart Knightley and contributors | MIT (offered as MIT or GPL 3; Patter takes MIT) | Patterpad, the binaries |
| xmldom, JSON5, ws, and electron-updater | their authors | MIT | Patterpad; xmldom also in the binaries |
| nspell, the spell-check engine | Titus Wormer | MIT | Patterpad |
| The en-US and en-GB spell-check dictionaries | Kevin Atkinson's SCOWL, through wooorm's dictionary packages | SCOWL's own permissive licence (attribution only), with each dictionary | Patterpad |
| Newsreader and Inter | their project authors, through Fontsource | SIL Open Font License 1.1 | Patterpad, the binaries (the PDF export) |
| Literata, Source Serif 4, and Courier Prime | their project authors, through Fontsource | SIL Open Font License 1.1 | Patterpad (the reading-font themes) |
| IBM Plex Mono | IBM, its own unmodified release | SIL Open Font License 1.1, Reserved Font Name "Plex" | Patterpad, the binaries (the PDF export) |
| Noto Sans, Noto Sans Math, and Noto Emoji | the Noto Project Authors and Google, through Fontsource | SIL Open Font License 1.1 | Patterpad, the binaries (the PDF export's fallbacks) |

Hunspell dictionaries you import into Patterpad yourself keep their own licences: that's between you and wherever you got them. See [Spell-check](/spell-check/) for how the dictionaries are used.

A PDF the export writes embeds only the characters it uses, and the Open Font License doesn't cover documents made with a font.

The repository's [`THIRD-PARTY-NOTICES.md`](https://github.com/patterkit/patter/blob/main/THIRD-PARTY-NOTICES.md) says the same for the source, and how the builds collect their notices.
