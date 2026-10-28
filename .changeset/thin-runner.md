---
"@patterkit/play-helpers": minor
---

**A thin runner for straightforward games.** `new Runner(engine, flowId?)` plays a flow a beat at a time as events
(`line`, `text`, `gameEvent`, `choice`, `ended`): `begin(scene?, block?)`, then `next()` for each beat and
`choose(id)` at a choice, with `stop()` and `rebind(engine)` after a hot swap. Every beat waits for `next()`;
handlers may call it themselves without deepening the stack. It keeps no save state and dictates no UI or audio.
The same runner is in Unity, Godot, and Unreal.
