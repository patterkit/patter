---
"@patterkit/ops": patch
---

The coverage summary no longer says "0 stalled at a choice with nothing to pick": a run can't stall any more, since a choice with nothing to pick runs dry, so a stall is named only if one ever happens.
