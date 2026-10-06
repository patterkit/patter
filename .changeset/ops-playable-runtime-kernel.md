---
"@patterkit/ops": patch
---

Playable HTML exports carry `@wildwinter/expr` 0.5.1 and `@wildwinter/scoperegistry` 0.8.1 (expression kernel `k492cf234`): a listener's own error is no longer reported as a read-only refusal, and every listener registered when a write starts hears it exactly once.
