---
"@patterkit/compiler": minor
"@patterkit/ops": minor
---

**An extension's pick can take any name, and suggest the ones already used.** A pick with a `{ "pool": name }`
source (toolkit 1.2.0) accepts any text, for names only the game knows, such as a level's points of interest.

- `extensionPass` counts each extension's pools over the project's data and returns them as `pools` (by extension,
  then pool, the commonest value first); `runValidate` returns them as `extensionPools`, for an editor to suggest.
- Two names in a pool that differ only in case, spaces, or punctuation are a warning (`pool-near-duplicate`), since
  a game looking a name up would take them as two.
