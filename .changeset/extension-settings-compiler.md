---
"@patterkit/compiler": minor
---

`exportBundle` writes each Patter extension's settings into the bundle's `extensions` section (`settings`, keys sorted): every setting the manifest declares, with the project's value or else the setting's default, as `@wildwinter/toolkit/extensions`' `settingValues` resolves it. They're in the content hashes with the rest of the section. A project with no extensions compiles byte for byte as before.
