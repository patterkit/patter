---
"@patterkit/ops": patch
---

The inlined playable-runtime snapshot is refreshed for `describeBundle`

`runExportHtml` inlines a minified copy of `@patterkit/runtime`, so a runtime change is also a change to what this package ships. Without a release, a playable HTML export keeps embedding the previous runtime while the repo says otherwise.
