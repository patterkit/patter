# `patter` - the Patter CLI

Command-line tooling for **Patter** projects: scaffold, validate, format, compile, play, test
coverage, localise, report, and share authored dialogue. The CLI is a thin front end over
`@patterkit/ops` (the shared operations layer), so it does what the Patterpad editor does, in CI or a
terminal.

The full reference, with every flag, is at **[patterkit.dev/cli](https://patterkit.dev/cli/)**, and
`patter <command> --help` prints any command's usage.

## Install / run

- **npm:** `npm i -g @patterkit/cli`, which installs the `patter` command.
- **Standalone binary** (no Node needed): the `patter` executable for your platform, from
  [the downloads page](https://patterkit.dev/download/). Put it on your `PATH`.
- **From a checkout of this repo:** `node packages/cli/dist/cli.js <command>` (run `npm run build` in
  `packages/cli` first).

## Quick start

```sh
patter init my-game --name "My Game" --vcs git   # scaffold my-game.patter
patter play my-game.patter                       # play it through the runtime
patter export my-game.patter                     # compile -> patter-dist/my_game.patterc beside it
```

## Commands

Most commands take a project `path`: a folder, or any file inside the project, from which the CLI
walks up to the nearest `*.patterproj`. It defaults to the current folder.

| Command | What it does |
|---------|--------------|
| `init [dir]` | Scaffold a new project with a starter scene and version-control config. |
| `validate [path]` | Check structure, expressions, interpolation, encoding, localisation files, a stale bundle, and unresolved merges. The command to gate a pull request on. |
| `format [paths...]` (`fmt`) | Rewrite Patter source to canonical form; `--check` for CI. Anything that is not a shard is left alone. |
| `export [path]` | Compile the `.patterc` bundle (plus the game's scopes file and the audio manifest, where the project has them). Refuses content `validate` finds errors in. |
| `export-html [path]` | One self-contained, playable `.html` page. |
| `export-script [path]` | A readable screenplay, as `.pdf` or `.docx`. |
| `play [path]` | Play the story non-interactively and print a transcript. |
| `coverage [path]` | Play the story many times with random choices and find content nobody reaches. |
| `resolve <query> [path]` | Find a line or node by id, Game ID, or name. |
| `usage <query> [path]` | Find everywhere a property is used. |
| `report [path]` (`stats`) | The production report; `--xlsx` for a spreadsheet, `--json` for pipelines. |
| `loc-export [path]` | Export strings for translation (JSON, Excel, or PO). |
| `loc-import <file> [path]` | Import a translated file back. |
| `voice-export [path]` | The voice-recording script, as a spreadsheet. |
| `export-editable [path]` | An editable `.docx` script for an editor outside Patter. |
| `import-editable <file> [path]` | Bring that file back as suggestions and comments. |
| `suggestions [path]` | List open suggestions; `--accept-clean` accepts the clean ones. |
| `share-scopes [path]` | Share the project's scopes with the game's other editing tools. |
| `pack [path] -o file` | Pack a project into one portable `.patterpack`. |
| `unpack <file> -o dir` | Explode a pack into a project, or with `--merge --base sent.patterpack`, fold a returned one back in. |
| `merge BASE OURS THEIRS` | 3-way structured merge of Patter source by node id (git's merge driver). |
| `mergetool BASE THEIRS OURS OUT` | The single merge tool for Perforce, Plastic, and SVN: Patter source to the structured merge, anything else to your usual tool. |
| `--version` | Print the version (also `-v`, `version`). |

## Conventions

- Every write goes through your version control (checking a file out first, adding new files), so a
  locked or read-only file fails the write rather than being overwritten.
- `patter <command> --help` (or `-h`, or `patter help <command>`) prints that command's usage.
- A flag takes its value as the next word or inline (`--seed=-5`). Anything starting with `-` is a
  flag, so a mistyped one is refused rather than read as a path. `-o -` streams text output to stdout
  where that makes sense.
- Usage errors are printed under `usage:`, followed by the command's whole form.

## File types

| Extension | Role | In version control? |
|-----------|------|---------------------|
| `.patter` | The **project** folder (a macOS package; a plain folder elsewhere) | yes, it *is* the source tree |
| `.patterproj` | Project settings (inside the `.patter`) | yes (source) |
| `.patterflow` | One scene's structure | yes (source) |
| `.patterloc` | Localised strings, per scene per language | yes (source) |
| `.patterx` | Authoring metadata (status, comments, suggestions) | yes (source) |
| `.patterc` | Compiled runtime bundle (`export` output, strict JSON) | committed by default (see `init --bundle`) |
| `.patterpack` | Packed portable document (`pack` output, a zip) | no, ignored |

Source files are UTF-8 + LF JSON5 (trailing commas allowed); `patter format` keeps them canonical,
and the version-control config from `patter init` pins the encoding and wires up the structured merge.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success. |
| `1` | The operation ran but found problems or failed (validation issues, a failed playthrough, a write failure). |
| `2` | Usage error (unknown command or flag, a missing value). `merge` and `mergetool` also exit 2 for input that is not Patter source, so a version control can fall back to its own merge. |
