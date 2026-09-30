# Version-control setup for this Patter project

No VCS selected (`patter init --vcs git|perforce|plastic|svn` emits tailored
config). Whichever you adopt, the rules are the same: Patter source is UTF-8 +
LF text, one scene per file, and `patter validate` belongs in your pre-commit /
CI. Sections for every supported VCS:

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

## Perforce

Add Patter extensions to the typemap (`p4 typemap`): source shards and the
compiled bundle are TEXT with LF; the packed document is BINARY:

    text   //....patterflow
    text   //....patterloc
    text   //....patterx
    text   //....patterproj
    text   //....patterc
    binary //....patterpack

On a unicode-mode server, set `P4CHARSET=utf8`. For the lock-based workflow
(spec: one scene per file = one lock per scene), add `+l` to make checkouts
exclusive. A `.p4ignore` (already emitted) keeps the packed document out of the
depot.

Perforce allows ONE global merge tool, so set `patter mergetool` as it - it
runs the structured merge for Patter source and hands everything else to your
normal tool. Map Perforce's variables into the order BASE THEIRS OURS OUT:

    patter mergetool --fallback "<your merge tool>" %b %t %y %r

(`%b` base, `%t` theirs, `%y` yours/ours, `%r` result - adjust to your P4
client's variable names; the argument ORDER is what matters.)

## Plastic SCM (Unity VC)

Patter source shards are plain UTF-8 text; Plastic handles them as-is. The
`ignore.conf` (already emitted) keeps the packed document out of the repo. For
the lock-based workflow, configure exclusive checkout (lock.conf) for the shard
extensions.

In Preferences > Merge tools, add an external tool (a global entry is fine -
the wrapper sniffs the path) with the arguments in BASE THEIRS OURS OUT order:

    patter mergetool --fallback "<your merge tool>" @basefile @sourcefile @destinationfile @output

## SVN

Set auto-props so Patter source keeps LF (`~/.subversion/config` or repo config):

    [auto-props]
    *.patterflow = svn:eol-style=LF
    *.patterloc = svn:eol-style=LF
    *.patterx = svn:eol-style=LF
    *.patterproj = svn:eol-style=LF
    *.patterc = svn:eol-style=LF
    *.patterpack = svn:mime-type=application/octet-stream

SVN's ignore is a directory PROPERTY, not a file - set it from the project root:

    svn propset svn:ignore "*.patterpack\n*.patterconflict" .

For the lock-based workflow add `svn:needs-lock` to the shard patterns.

SVN allows one global merge tool. Point `[helpers] merge-tool-cmd` at a small
wrapper script that forwards SVN's four arguments (base theirs mine merged =
BASE THEIRS OURS OUT) to `patter mergetool`:

    #!/bin/sh
    exec patter mergetool --fallback "<your merge tool>" "$1" "$2" "$3" "$4"

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
