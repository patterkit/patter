---
"@patterkit/ops": minor
"@patterkit/cli": minor
---

**Translation import checks the file.** `applyLoc` skips a line the project doesn't have (it isn't written,
counted, or stamped) and returns a `report` listing those lines and every translation whose `{@ref}`
placeholders or `<b>`/`<i>`/`<bi>` markup don't match the source as it is now (those still import).
`describeLocImport` turns the report into lines to show, and `importLocale` decides the language: a file for
one language is refused as another, and one naming none imports as the language chosen, with a warning. The
Excel export now carries its language on a hidden "Patter" sheet. `patter loc-import` refuses a file whose
language differs from `--locale` unless `--force-locale` is given, and prints the report after its counts.
