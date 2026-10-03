# @patterkit/ops

Every operation on a Patter project as a plain function: loading, validating, exporting, formatting,
playing in the terminal, reports, localisation, script exports, packing, merging, and more. The `patter`
command line tool and the Patterpad editor are both thin front-ends over this package, so they behave the
same way by construction.

Most people won't need to install this directly. To play Patter dialogue in a game or web page, use
[`@patterkit/runtime`](https://www.npmjs.com/package/@patterkit/runtime); to work with Patter projects from
a terminal or a build script, use [`@patterkit/cli`](https://www.npmjs.com/package/@patterkit/cli).

## How it works

The functions don't print, prompt, or exit, and the ones that change files don't write them. They return
the writes they plan, and the caller applies them (`applyWrites`, or its own route through version
control), so a front-end decides how changes reach the disk.

## What's in it

- **Loading and checking**: `loadProject`, `runValidate`, and `runFormat`.
- **Exporting**: `runExport` for the `.patterc` bundle, `runExportHtml` and `runExportWeb` for playable
  pages, and `runPlay` for a playthrough in the terminal.
- **Scripts**: the readable script as `.docx` or `.pdf` (`runScriptDoc`, `scriptToDocx`, `scriptToPdf`),
  the voice script, and the editable script round trip (`exportEditableScript`, `readEditableDocx`, and
  `planEditableImport`), which sends a script to an editor in Word or Google Docs and brings their
  changes back as suggestions.
- **Localisation**: `extractLoc` and `applyLoc`, with JSON, PO, and Excel formats.
- **Review and production**: reports, coverage tests, search and replace, suggestions, and voice and
  audio status.
- **Sharing**: `runPack` and `runUnpack` for `.patterpack` files, and `runMerge` for merging changes made
  in two places.

```sh
npm install @patterkit/ops
```

## Part of Patter

[Patter](https://patterkit.dev/) is a branching dialogue format with its own editor (Patterpad), command line
tool (`patter`), and runtimes for JavaScript, Unity, Unreal, and Godot. This package is one layer of the
JavaScript tooling, and the other `@patterkit` packages build on it. [How it fits
together](https://patterkit.dev/architecture/) shows where each piece sits, and the source is in the
[patter repository](https://github.com/patterkit/patter).

## Licence

MIT
