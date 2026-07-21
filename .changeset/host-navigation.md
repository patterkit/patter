---
"@patterkit/runtime": minor
---
Host navigation by address. `flow.goto(scene, block?)` sends a running flow to a Game ID address, behaving exactly like a jump the writer could have written: the destination scene's `onEntry` runs, arriving counts as a visit, and the callstack is replaced (pending call-returns discarded). Being a host action rather than an authored one it lands immediately - the rest of the snippet being delivered is abandoned and a pending choice dropped - and it MOVES the cursor without resetting the flow, so variation, visit counts and per-flow properties all carry on. Returns `false` with the cursor untouched when the address does not resolve; a block address is scene-scoped.

`engine.runFlow(name, scene, block?)` is the one-call form: it opens the named flow if it does not exist, moves it if it does, runs to the next stop and returns the beats played. Reusing the name is the point - a flow owns its selector cursors, so a shuffle keeps its bag and an "once each" list keeps its place from call to call. `[]` means the address has nothing left to give; an unresolvable address throws, so the two are never confused.

Dropping a flow now FINISHES it: `closeFlow`, `engine.reset()` and re-opening a name all leave the old `Flow` inert (`advance()` reports the end, `goto()` refuses), so a stale host reference can no longer keep running scene entry effects and moving shared state. Re-opening a name still replaces (and resets) that flow, which is what `runFlow` deliberately does not do.

All four runtimes ship this identically, pinned by a new conformance corpus case. The three native ports also gain `advanceToStop`, which until now only the JS runtime had.
