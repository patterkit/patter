---
"@patterkit/ops": minor
"@patterkit/cli": patch
---

`validate` now reports conditions that provably can never hold.

A snippet gated on `@connected && !@seen`, where the only writer of `@connected` is itself gated on `@seen` and nothing sets `@seen` back, is unsatisfiable. `ValidateResult.reachability` names the chain, and `patter validate` prints it as `[unreachable]`. The analysis covers monotonic latches only (a boolean only ever written `true`, a flag only ever `+set`); anything written another way, host-driven, `temporary`, or already true by default drops out rather than being guessed at, because a false "this can never happen" is worse than silence. Warnings, deliberately outside `ok`: they never fail a build. Adapted from a design contributed by the Storylet Studio side.
