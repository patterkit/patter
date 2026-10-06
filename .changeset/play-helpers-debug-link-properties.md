---
"@patterkit/play-helpers": patch
---

The debug link no longer queues messages once the editor is gone: with no editor running it kept one message per step for the rest of the game. The property helpers (`getProperty`, `setProperty`, `setProperties`) now take a flow as well as the engine, which `@scene` properties need, since each flow has its own. The documented `setProperties(engine, { "@scene.locked": false })` threw.
