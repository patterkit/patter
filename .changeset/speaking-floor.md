---
"@patterkit/model": minor
"@patterkit/ops": patch
"@patterkit/conformance": minor
---

A line with no recording can be quick: `estimateLineDuration` now clamps to 0.5 to 18 seconds, not 1.5 to 18, since the shortest a line lasts is a speaking time, the least a spoken word plausibly takes, not a reading time. An unvoiced "No." answered by "Yes." no longer takes three seconds. `@patterkit/model` gains `SUBTITLE_READING_MIN` (1.5 seconds), the least time a line's text should stay on screen to be read, for a tool that shows lines as subtitles or overhead text: it keeps the text up at least that long after a shorter line ends, overlapping the next if it must, while the line itself still ends when it's said. The playable HTML page takes the new pace (its lines stay on the page as they play). The conformance corpus is version 15: the duration cases at the floor re-pinned, and the scripted op `applyLiveBundle`.
