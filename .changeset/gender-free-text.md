---
"@patterkit/model": patch
---
`GrammaticalGender` is now `string` (was the closed union `"male" | "female" | "neuter"`), because three genders don't cover every language (common/utrum, animate/inanimate, and so on). A new exported `COMMON_GENDERS` lists the everyday values for editors to offer as auto-suggest defaults. The value is still authoring-only translator context, dropped from the compiled bundle; every export format already carried it as an opaque string, so nothing downstream changes.
