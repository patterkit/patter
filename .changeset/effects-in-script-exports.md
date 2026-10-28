---
"@patterkit/ops": minor
---

**Effects in the script exports.** The readable script (Word and PDF) and the editable script show a
snippet's `onEnter` and `onExit` effects, and a scene's `onEntry`, as a quiet line of plain words labelled as
Patterpad labels them: `On begin: sets gold to gold + 1`, `On end: sets @world.threat to 3`. A Patter
property is named bare and any other scope's in full; a quality advancing itself reads `advances debt`, a
flags change `adds calm to mood`, and an enum value or stage is shown without its quotes. `ScriptElement`
gains an `effect` kind (`phase` is `begin` or `end`), and `effectDescriber` gives the wording. In the
editable script an effect line has its own paragraph style and isn't part of the handoff record: the
re-import reads it as a `ReadEffect` and skips it, so an edit to one changes nothing, and a comment on one
lands on the line it sits with. The project's comment threads are never written into the editable script,
so the only comments in a returned file are the editor's.
