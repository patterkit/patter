---
"@patterkit/cli": minor
---

`patter validate` prints the project's extension issues under `[extension]`. `patter merge` and `patter mergetool` merge an extension data shard field by field by its manifest, read from the project the real file is in (`--path`, git's `%P`), and `--type` takes `extension`. `patter format` on a project folder takes an extension at its manifest's new version and says what it renamed, and `patter unpack --merge` says when it kept the project's own copy of an extension's manifest.
