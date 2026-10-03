---
"@patterkit/model": minor
---

Groundwork for the editable script handoff, all additive:

- A `Suggestion` can now also propose a new speaker (`proposedCharacter`), a new direction (`proposedDirection`), or cutting the beat (`proposedCut`), each with its own baseline for the staleness check. It can credit several people (`authors`, with `author` staying the primary), and record the handoff it arrived in (`handoff`).
- New `HandoffFile` record (schema `patter/handoff@0`, exported as `HANDOFF_SCHEMA`), with `HandoffLine`, `HandoffRow`, and `HandoffImport`.
- `DEFAULT_DOCUMENTATION_CLASSES` gains `editor`, delivered to the `editor` channel: notes meant for an outside editor.
