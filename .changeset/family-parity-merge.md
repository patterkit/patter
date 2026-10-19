---
"@patterkit/ops": minor
"@patterkit/core": patch
---

Merges follow the family's shared rules (`@wildwinter/toolkit` 0.2.2), as Storylets' do. Declaration lists (properties, cast, and each node type's gameData fields) keep the author's order instead of being re-sorted by name, so Move up and Move down survive a merge: the side that reordered wins, two different reorders clash, and the other side's additions go in after the entry they followed. Comment threads merge message by message and field by field, so an edit to a message and a moved anchor are no longer lost, and a message edited two ways is a conflict. A line's tags merge as a set, so two people tagging one line no longer clash. Conflict paths into a declaration list now name the entry in brackets (`cast[PLAYER]`).
