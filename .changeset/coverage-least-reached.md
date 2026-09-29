---
"@patterkit/ops": minor
"@patterkit/cli": minor
---

Coverage leads with what it reached least. A beat that played, but in fewer than 5% of runs, is now flagged as rarely reached (`rare` on the beat, `totals.rare` and `rareThresholdPct` on the report, `~` in the text), and `leastReachedFirst` gives the ordering. `patter coverage` now lists beats least reached first, with `--order script` for the script's order; its table labels its two columns (reached, played) and says in words how the runs ended.
