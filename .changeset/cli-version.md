---
"@patterkit/cli": minor
---

`patter --version` (also `-v`, `patter version`) prints the CLI's version.

The CLI ships as a self-contained per-platform binary: no `package.json` beside it, no npm that installed it, and a filename that is whatever the downloader called it. The tool was the only thing that could answer "which build is this?" and it printed the usage text instead, which reads as a refusal. The number is inlined from the manifest at build time rather than kept in a constant, and both shipping paths (tsup and Bun `--compile`) were run to confirm it, since a JSON import a bundler fails to inline is a runtime `undefined` rather than a build error. Reported from the Storylet Studio side.
