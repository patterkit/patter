---
"@patterkit/model": minor
---

`BundleExtension.settings`: the bundle carries each Patter extension's settings, every one its manifest declares, by setting name, with the project's value or else the setting's default. It's present only when the manifest declares settings, so a bundle whose extensions declare none is unchanged.
