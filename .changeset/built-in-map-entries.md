---
"@patterkit/model": patch
"@patterkit/core": patch
"@patterkit/compiler": patch
"@patterkit/ops": patch
"@patterkit/cli": patch
---

**An extension's built-in table entries count as choices.** Where an extension's manifest says what a table already
holds (a map's `builtIn`), a pick that offers the table's names now offers those too, and `patter validate` accepts
them, so an extension no longer has to repeat them as fixed words.

- It comes with toolkit 1.3.0, which also checks the built-in entries themselves: one that doesn't fit the table is
  `built-in-misfit`, and `builtIn` on anything but a map with text keys is `built-in`.
- A bundle carries the project's own table as it is: the built-in entries are for the editors, and the extension's
  runtime keeps its own copy.
