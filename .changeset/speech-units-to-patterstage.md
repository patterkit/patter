---
"@patterkit/model": minor
"@patterkit/core": minor
"@patterkit/compiler": minor
"@patterkit/ops": minor
"@patterkit/conformance": minor
---

**Breaking:** speech units have moved to Patterstage, and a line with no recording is timed by its weighted characters at a speed. model: `speechUnits`, `countSyllables`, `SpeechUnit`, `SpeechUnitKind`, `SpeechVowel`, and the `SPEECH_*` constants are removed; `estimateLineDuration(text, locale?, speed?)` weighs each code point as 1, a Han character 3, kana 2, a Hangul syllable 2.5, and a soft hyphen 0, at `LINE_CHARS_PER_SECOND` (14) times `speed`, clamped to 0.5 to 18 seconds (`locale` reserved, unused; a speed that isn't a finite positive number is 1), with the weights in `LINE_CHAR_WEIGHTS`; `DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND` and its range become `DEFAULT_ESTIMATE_SPEED` (1), `ESTIMATE_SPEED_MIN` (0.5), and `ESTIMATE_SPEED_MAX` (2.5); the project file's and bundle's `estimateSyllablesPerSecond` is now `estimateSpeed`, and `normaliseEstimateSpeed` reads an old project's value as `estimateSpeed = old / 4`. core: the problem `invalid-estimate-rate` is now `invalid-estimate-speed`. compiler: the bundle carries `estimateSpeed` when the project sets one. ops: loading a project reads the old key as the new, and the playable HTML page times lines by the step's `estimateSpeed`. conformance: corpus version 17, the speech section removed and the duration cases re-pinned, with new ones; a spoken step records `estimateSpeed` in place of `estimateRate`.
