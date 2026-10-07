---
"@patterkit/cli": minor
---

The CLI review of October 2026.

- Flags follow the family's grammar: `patter <command> --help` (or `-h`, or `patter help <command>`) prints that command's usage, every token starting with `-` is a flag, `--flag=value` works, a stray argument or two flags that contradict each other are usage errors, and every usage error is printed under `usage:` with the command's whole form. An unknown command is named on stderr.
- `export` writes the bundle to `patter-dist/<name>.patterc` beside the project folder, where Patterpad's Build Bundle writes, unless the project names its own path. It refuses a project `validate` finds errors in, listing them; `--allow-invalid` builds it anyway. It also writes the Audio Folders manifest, `patteraudio.json`.
- `export-html` and `export-script` land beside the bundle whatever its extension, and never on it.
- `merge` takes `--path` (git's `%P`), so the conflict sidecar lands beside the real shard; merge results are written directly rather than through version control, which holds its own locks during a merge. Re-register the driver as `patter merge %O %A %B -o %A --path %P`.
- `unpack` writes only shards, scopes files, and handoff records, refuses a pack holding a dot-file or dot-folder, refuses a folder that holds a different project, and says when a file is not a pack. `unpack --merge` writes only the shards that changed, sidecars first.
- `format` leaves anything that is not Patter source alone, and takes a project folder.
- `-o -` streams JSON and PO from `loc-export` and the merged source from `merge`, and is refused where the output is not text. Binary outputs create their folder.
- `coverage --runs` and `--max-steps` must be whole numbers of at least 1; `--propose` says which flags it ignores.
- `validate` prints localisation problems, and a choice that can run dry as a warning.
- `init` writes everything or nothing, the project file last; `mergetool` says when its fallback cannot start; `suggestions --json` is compact like every other `--json`.
