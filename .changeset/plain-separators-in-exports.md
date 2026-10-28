---
"@patterkit/ops": patch
"@patterkit/cli": patch
---

**Plainer labels in script exports and the CLI's help.** The Word, PDF, and editable scripts no longer use "·" as a
separator: `game event: door.open`, `One of (first match wins)`, `In sequence (shuffled)`, `else (catch-all)`, and
an option's flags joined with commas. The editable script's header reads `Name: editable script. Handoff X,
exported D.` Re-importing an edited script is unaffected.
