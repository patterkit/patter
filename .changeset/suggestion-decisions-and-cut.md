---
"@patterkit/ops": minor
---

`applySuggestionDecisions` accepts or rejects suggestions on the project's files, for reviewing many at once: an accept applies every part a suggestion carries (text, speaker, direction, cut) and stamps the line's edit time so its translations read as stale, and a suggestion whose text or speaker changed since it was made is refused as stale rather than applied over the newer work. `setCut` marks nodes or beats cut, or brings them back.
