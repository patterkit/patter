---
"@patterkit/model": minor
"@patterkit/core": minor
"@patterkit/compiler": minor
---

Speaker qualifiers: a line can say how it is delivered, a screenplay's `TAM (O.S.)`, without becoming a second character.

- `@patterkit/model`: `LineBeat.qualifier` (the qualifier's `gameId`), `ProjectFile.qualifiers` with `DEFAULT_QUALIFIERS` (`V.O.`, `O.S.`, `RADIO`), `projectQualifiers`, `usedQualifiers`, `qualifierStringKey`, `Bundle.qualifiers`, the qualifier on a saved choice prompt, and qualifier slots on handoff lines and suggestions.
- `@patterkit/core`: `validateProject` reports a line whose qualifier isn't in the project's list (`unknown-qualifier`) and a malformed list (`invalid-qualifier`).
- `@patterkit/compiler`: the bundle carries the qualifiers the lines use, and folds them into its hashes; a project that uses none compiles exactly as before.
