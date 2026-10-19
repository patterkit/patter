---
"@patterkit/ops": minor
---

Action text in the production tools. `extractLoc` leaves a dialogue scene's action text out; `applyLoc` drops any translation of it a shard still holds (`ApplyStats.dropped`), refuses one a file brings back, and marks each translated shard it writes with whether its scene's text was action (`textAction`). `actionTextChanges` lists the text that has dropped out of the loc files or come into them since, and `describeLocExport` words what an export says beside the file: how many text lines it left out as action, and the setting that does it, then those changes. `runValidate` warns, naming the scene, when a scene's kind no longer matches its loc files. `runReport` counts action beside the written lines (`action` on each scene and in the totals), never in them or in the localisation counts, and the report spreadsheet adds Action columns when there's any. The playable HTML export shows action as a direction, timed by its pause alone.
