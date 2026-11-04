---
"@patterkit/play-helpers": minor
---

Play in game: Patterpad can ask the running game to start a block now. `createDebugLink` takes an `onPlay` handler, which gets `{ id, sceneId, blockId, takeOver, build? }`, and the link gains `replyPlay(id, { started, reason?, detail? })` to answer, at once or later. With no `onPlay` the link answers `{ started: false, reason: "unhandled" }` itself. New types `PlayRequest` and `PlayResult`.
