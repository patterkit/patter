---
"@patterkit/model": minor
"@patterkit/core": minor
"@patterkit/compiler": minor
---

Line padding: the pause after a line, a writing decision every tool now times the same way.

- `@patterkit/model`: `padAfter` on line and text beats, in seconds (negative cuts the next line in on this one); `padAfterDefault` on snippets, groups, blocks, scenes, the project, and the bundle; `DEFAULT_PAD_AFTER` (0.6), `PAD_AFTER_MIN` and `PAD_AFTER_MAX`.
- `@patterkit/core`: `validateProject` reports a pause outside the range (`invalid-pad`), and warns on a negative pause on a snippet's last line, which can't cut in across the seam (`pad-overlaps-seam`).
- `@patterkit/compiler`: the bundle carries the defaults, and the project's when it sets one, folded into its hashes; a project that sets none compiles exactly as before.
