# Version-control setup for this Patter project

## git

`.gitattributes` (already emitted) pins Patter source shards to UTF-8 + LF text
and marks the generated artifacts (the `.patterc` bundle `merge=ours`, the
`.patterpack` document `binary`). `.gitignore` (already emitted) keeps the document
(and the bundle, under the "ignore" posture) out of source control.

Recommended pre-commit hook (`.git/hooks/pre-commit`, executable):

    #!/bin/sh
    patter validate || exit 1

The `merge=patter` rules in `.gitattributes` are already active; register the
drivers once per clone (git config is not repo-tracked) - until then git falls
back to a normal text merge for those files:

    git config merge.patter.name "Patter structured merge"
    git config merge.patter.driver "patter merge %O %A %B -o %A"
    git config merge.ours.driver true

git invokes the per-path driver directly (no `mergetool` wrapper needed). `%O %A
%B` are base / ours / theirs; the merged result is written back to `%A`. On a
conflict `patter merge` exits non-zero and writes a `.patterconflict` sidecar
beside the file, so the merge stays unresolved.

## Compiled bundle & packed document

This project COMMITS the compiled `.patterc` bundle (`patter init --bundle ignore`
to build it in CI instead). The bundle is regenerated, never hand-merged: on a
conflict, keep ours and re-run `patter export`. `patter validate` recomputes the
bundle's embedded hash from source and FAILS if it is stale, so a forgotten
regenerate cannot ship silently.

The packed `.patterpack` document (`patter pack`) is the send-and-return envelope
for collaborators without VCS. It is a binary zip and a projection of the
shards - NOT source - so it stays out of version control (ignored above); edits
return via `patter unpack`.
