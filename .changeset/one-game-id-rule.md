---
"@patterkit/model": patch
"@patterkit/core": patch
---

**One Game ID rule for the family.** `gameIdify` and `isValidGameId` now come from `@wildwinter/toolkit`
(0.4), which Storylets addresses its cards by too, so a scene and the card that plays it can't disagree
about an address. `@patterkit/model` takes the toolkit as a dependency and re-exports both, as
`@patterkit/core` re-exports model's, so nothing that imports them changes. The rules are the same as
before: lower case, apostrophes dropped, any other run of punctuation a single hyphen.
