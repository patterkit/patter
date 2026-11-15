---
"@patterkit/model": minor
"@patterkit/compiler": patch
"@patterkit/ops": patch
"@patterkit/cli": patch
---

**One walk over every line, and quicker exports.** `@patterkit/model` adds `walkBeats`, which visits every line,
text, and choice prompt under a scene's content, and `beatsOf`, a single node's own. The tools use them in place of
their own copies, so a new kind of line can't be missed in one place and caught in another.

- `export`, `format`, and `pack` look through the project folder once instead of once per kind of file, and export
  rereads only the files that changed since the last check, which saves time on every Auto Rebuild of a project
  with many voice clips beside it.
- `validate` and `export` now share one set of content checks, so a check added later reaches both.
