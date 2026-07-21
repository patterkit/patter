---
"@patterkit/ops": patch
---
Refresh the inlined Patterplay runtime blob (`playable-runtime.ts`) so a published playable HTML page carries the current runtime, including the new host navigation API (`goto` / `runFlow` / `advanceToStop`). The blob is a snapshot of the runtime's built `patterplay.min.js`, so it drifts whenever the runtime changes and has to be regenerated after a build.

Note the JS runtime itself is deliberately NOT versioned by Changesets - `npm run bump:play` is its version authority, and `changeset publish` picks it up because its local version is ahead of the registry.
