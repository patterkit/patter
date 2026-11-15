---
"@patterkit/cli": patch
---

**Writes to a file someone else has locked on Perforce now say so.** When another person has a file opened exclusively,
the CLI reports that write as refused and names who holds it, where before it counted the write as done.
