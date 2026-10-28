---
"@patterkit/model": minor
"@patterkit/ops": minor
---

**A character keeps their colour through a rename.** `CastMember` gains an optional, authoring-only `colour`:
a slot of the editors' 12-colour palette (0 to 11). Absent, a character's colour still comes from a hash of
their name, so a cast needs no setup; renaming a character in Patterpad stamps the slot their old name had,
so their cues don't change colour. It never reaches a bundle: `BundleCastMember` leaves it out, and the
compiler's cast allow-list doesn't copy it. In ops, `characterColour(name, stored?)` answers the stored slot
when it's a valid one, `castColours(cast)` maps names to their stored slots, a `line` element of the readable
script carries its speaker's `colour`, so the Word, PDF, and editable scripts paint the cue in it, and
`keepCastColours(cast, renames)` stamps the old name's slot on each renamed member that has none.
