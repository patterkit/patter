---
"@patterkit/model": minor
"@patterkit/ops": patch
---

The save shape gains an optional `FlowCursor.pendingPrompt`: the prompt `replayPromptOnChoose` is still to speak back, as the choice showed it. The runtime inlined into playable HTML exports is refreshed to the current engine (only an authored prompt is replayed, exactly as shown).
