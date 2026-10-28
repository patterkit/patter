---
"@patterkit/core": minor
"@patterkit/ops": patch
---

**A warning for content that can never run.** `validateProject` raises `unreachable-after-jump` (a warning) on
anything after an unconditioned snippet that jumps (`END` included, beats or not) in the same run: a block's
children, a plain group's, or an option's own run. A `call`, a jump with a condition, and a jump inside an
option, a conditional group, or a `branch` or `sequence` child hide nothing outside it. The issue's `id` is the
node that never runs and `jumper` the snippet that jumps. The walk is exported as `neverRunNodes`, and
coverage's input hints now read it too, so a beat after an unconditioned jump no longer gets a `needsInput` or
`blockedBy` hint.
