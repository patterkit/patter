---
"@patterkit/core": minor
---

`@patterkit/core`: `planProject({ name })` and `planScene(target, scaffold)`, for another tool to create a Patter project beside its own and hand a writer a stub scene. Storyletter uses it for a card in a box Patter performs that has no scene yet: the scene is named after the card, its address pinned to the card's gameId, the card's purpose as its opening line, and one option per outcome labelled with that outcome's gameId in its Game Data (no choice for a card with one outcome). Pure: it returns project-relative paths and canonical content for the caller to write.
