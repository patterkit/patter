---
"@patterkit/model": minor
"@patterkit/core": minor
"@patterkit/compiler": minor
"@patterkit/ops": patch
"@patterkit/conformance": minor
---

A line with no recording is timed by the syllables it would be spoken in, not its characters, so a Chinese, Japanese, Korean, Arabic, or Thai line no longer leaves the screen too soon. `@patterkit/model` gains `speechUnits(text, locale)` (the line's syllables, shut beats, and pauses, each weighed, with code-point offsets, from one generated table every runtime carries) and `countSyllables`; `estimateLineDuration(text, locale, syllablesPerSecond)` is their total weight at the project's rate (default 4 a second), clamped to 1.5 to 18 seconds as before. `locale` is the language the line is spoken in, the project's main language. The project's new `estimateSyllablesPerSecond` (2 to 10, the new problem `invalid-estimate-rate` outside that) reaches the bundle only when set. The playable HTML page times each line by its text in the project's main language, whatever language it shows. The conformance corpus is version 11: the `speech` section, the duration cases re-pinned, and the spoken fields of a line or text step.
