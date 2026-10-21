---
"@patterkit/model": minor
"@patterkit/compiler": minor
"@patterkit/ops": minor
"@patterkit/cli": patch
---

Claims on host fields, and the manifest settings that named them, are gone from Patter extensions (ruled 2026-10-20, with `@wildwinter/toolkit` 0.3.0, which warns `removed-key` on a manifest that still has `settings` or a target's `claims`, and ignores them). The model drops `ProjectExtension.settings` and `BundleExtension.settings`. The compiler no longer checks a pin's settings or a claim on a gameData field, and the bundle carries no `extensions[id].settings`. `patter validate` warns once per extension whose pin in the project file still has `settings`, since nothing reads them now; the compile ignores them. The project file's three-way merge no longer merges a pin's settings key by key: each key of a pin merges as one value.
