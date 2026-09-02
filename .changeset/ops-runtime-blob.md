---
"@patterkit/ops": patch
---

Rebuilds the embedded playable runtime.

`runExportHtml` inlines a minified copy of `@patterkit/runtime`, so it carries a
build of the runtime rather than a dependency on one. That copy is regenerated
whenever the runtime's source changes; this picks up `listBags()` on the Engine
and Flow, and the scene and stage state moving onto the shared property bag.

No API change here.
