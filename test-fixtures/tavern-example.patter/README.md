# tavern-example.patter (pinned test fixture)

A **frozen** copy of the Tavern sample project, used by tests that assert exact
structure and play-paths (`packages/ops` end-to-end, `packages/patterpad` project
validation).

Do **not** edit this to try things out. It is intentionally stable so those tests
stay meaningful. The live, editable example you can change freely lives at
`examples/tavern/` — these tests deliberately do **not** point at that, so your
authoring there never breaks the suite.

If you change the engine/format in a way that should change this fixture, update it
deliberately and adjust the asserting tests to match.

---

It exercises the whole pipeline end to end (**author → validate → export → play**):
a choice point with eligible / greyed / hidden options, state-driven re-eligibility
via an `onExit` effect, `set` + `emit` effects, block-to-block and cross-scene
jumps, and `END`.

```
tavern.patterproj          project settings (properties, cast, voiced flag)
scenes/tavern.patterflow   the main scene (flow tree)
scenes/street.patterflow   a second scene (cross-scene jump target)
loc/en/*.patterloc         English strings, keyed by beat id
```
