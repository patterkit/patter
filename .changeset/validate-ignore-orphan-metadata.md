---
"@patterkit/core": patch
---
`validate` no longer flags per-beat authoring metadata (writing/recording status, cut flag, documentation notes) keyed on an id that no longer exists. Deleting a beat leaves that metadata behind as harmless residue - it never ships and has no runtime effect, exactly like an orphaned comment - so it is now ignored rather than reported as a structural error (which also kept `patter validate` from returning ok on a project with any stale metadata). Status-value-not-in-ladder and undeclared-doc-class checks still apply to LIVE beats. The `unknown-status-id` issue code is removed.
