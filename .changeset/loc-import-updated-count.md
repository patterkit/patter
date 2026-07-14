---
"@patterkit/ops": patch
---
`applyLoc` now counts only strings whose translation actually changed in `stats.updated`, instead of every non-empty string in the imported catalog. Re-importing an unedited file reports `0 updated` rather than the full line count.
