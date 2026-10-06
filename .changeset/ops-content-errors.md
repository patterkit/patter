---
"@patterkit/ops": minor
---

Coverage and playthroughs report content errors. The runtime now plays through a condition or effect that fails (a failing condition counts as false, a failing effect is skipped), so the coverage report gains `contentErrors`: each failure with its kind, node, scene, source, message, and the number of runs it happened in, also listed in `renderCoverageText`. `runPlay` records each as an `error` event in order, and `renderPlay` marks it with `!`. Playable HTML exports carry the runtime's new play rules.
