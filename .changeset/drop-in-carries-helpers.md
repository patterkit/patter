---
"@patterkit/play-helpers": minor
"@patterkit/ops": patch
---

`patterplay.min.js`, the zero-build browser drop-in, is now built by `@patterkit/play-helpers` and carries the helpers as well as the runtime on the one `Patterplay` global: `serializeState`, `deserializeState`, the state logger, the inspectors, the Live Link client and audio resolution. A plain page with no bundler can now write and read the family's save text. The file ships from this package on unpkg / jsDelivr (`@patterkit/play-helpers/dist/patterplay.min.js`) and, as before, loose on every play-js release and inside its zip. `@patterkit/ops` bundles the runtime for playable HTML exports itself (runtime alone, as those exports always were), since the shared drop-in grew the helpers.
