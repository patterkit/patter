---
"@patterkit/model": minor
"@patterkit/ops": patch
---

One exported rule for a scene reference: `resolveSceneRef(scenes, ref, byAddress?)` in the model resolves by the scene's address (its effective gameId) first, then its internal id, and `sceneAddressIndex(scenes)` builds the address lookup once for many references, so a tool that has to land where the game will calls the same function rather than keeping a copy. The runtime resolves with it, and ops' playable runtime is regenerated to match; nothing plays differently.
