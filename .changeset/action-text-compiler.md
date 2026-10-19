---
"@patterkit/compiler": minor
---

`exportBundle` compiles a dialogue scene's text beats as action when the project doesn't localise them (`localiseDialogueText` off, the default): `action: true` on the beat, and its source text in every locale's string table, whatever a translated shard still holds. An option's prompt never is. **This changes existing projects:** a localised project that shows its dialogue scenes' text to players should turn `localiseDialogueText` on, which compiles exactly as before. A hand-written `action` key in source never reaches the bundle.
