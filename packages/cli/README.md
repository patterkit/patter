# `patter` - the Patter CLI

Command-line tooling for **Patter** projects: scaffold, validate, format, play,
compile, report, and package authored dialogue. The CLI is a thin front-end over
`@patterkit/ops` (the shared operations layer), so it behaves identically to the
Patterpad editor and to CI.

## Install / run

- **Standalone binary** (no Node required): the `patter` executable shipped for
  your platform - put it on your `PATH`.
- **npm** (once published): `npm i -g @patterkit/cli`, which installs the
  `patter` command.
- **From a checkout of this repo:** `node packages/cli/dist/cli.js <command>`
  (run `npm run build` in `packages/cli` first).

Running `patter` with no command prints usage.

## Quick start

```sh
patter init my-game --name "My Game" --vcs git   # scaffold a project
patter play my-game                              # play it through the runtime
patter export my-game                            # compile -> dist/my-game.patterc
```

## Commands

Most commands accept a project `path` - a directory, or any file inside the
project, from which the CLI walks up to the nearest `*.patterproj` - defaulting
to the current directory (`.`). The exceptions: `format` takes explicit files,
`unpack` takes a `.patter` file, and `resolve` takes a lookup query.

### `patter init [dir]`

Scaffold a new project: the project file, a minimal playable starter scene + its
strings, an `.editorconfig`, a `vcs-setup.md`, and the VCS config for your VCS.
Refuses to scaffold over an existing project.

| Option | Values | Default | Meaning |
|--------|--------|---------|---------|
| `--name <x>` | string | directory basename | Project display name. |
| `--vcs <x>` | `git` \| `perforce` \| `plastic` \| `svn` | none | Emit tailored VCS config (`.gitattributes` + an ignore file for git/perforce/plastic; SVN guidance in `vcs-setup.md`). |
| `--bundle <x>` | `commit` \| `ignore` | `commit` | Whether the compiled `.patterc` bundle is committed (kept honest by the validate staleness gate) or git-ignored and built in CI. |

```sh
patter init                       # scaffold in the current directory
patter init game --name "Heist"   # named, in ./game
patter init game --vcs git --bundle ignore
```

### `patter validate [path]`

Validate a project: structure + invariants (unique ids, no dangling jumps,
non-empty names, cast membership, scope rules), condition / interpolation
expressions, encoding + line-endings (UTF-8 no-BOM, LF), and **bundle staleness**
(any committed `.patterc` whose embedded hash no longer matches source). Exits
non-zero if there are any issues. Ideal as a pre-commit hook and in CI.

```sh
patter validate
patter validate my-game
```

### `patter format [files...]` (alias `fmt`)

Rewrite source files to canonical form (sorted keys, 2-space indent, LF, final
newline, trailing commas). Pass explicit files.

| Option | Meaning |
|--------|---------|
| `--check` | Report what *would* change and write nothing; exits non-zero if any file is non-canonical (for CI). |

```sh
patter format scenes/*.patterflow
patter format --check scenes/opening.patterflow   # CI: fail if not canonical
```

### `patter export [path]`

Compile a project (flow + selected locales) to a `.patterc` runtime bundle -
strict JSON the game runtime loads.

| Option | Meaning |
|--------|---------|
| `-o <file>` | Write to `<file>`. |
| `-o -` | Stream the bundle to stdout (for pipelines). |
| *(no `-o`)* | Write the conventional path: the project's `export.bundle`, else `dist/<project-name>.patterc`. |

```sh
patter export                       # -> dist/<name>.patterc
patter export -o build/game.patterc
patter export -o - | gzip > game.patterc.gz
```

### `patter play [path]`

Play a project through the reference runtime and print a transcript - lines,
text, game events, and choices. Exits non-zero if the playthrough cannot finish
(a stall / max-steps), which makes it usable as a smoke test.

| Option | Values | Meaning |
|--------|--------|---------|
| `--scene <id>` | scene id | Start at this scene. |
| `--block <id>` | block id | Start at this block. |
| `--choices <a,b,c>` | comma list | Auto-pick these option ids, in order, at successive choices. |
| `--seed <n>` | integer | Seed the runtime PRNG for reproducible selection. |

```sh
patter play
patter play --scene scn_tavern --choices opt_work,opt_secret
patter play --seed 42
```

### `patter resolve <query> [path]`

Look up an **id**, **handle**, or **name** and report what it is and where it
lives (file + location path). The CLI counterpart to the editor's dual search -
handy when a locale table or VO asset references something by id.

```sh
patter resolve scn_tavern
patter resolve "Tavern > Intro"
```

### `patter report [path]` (alias `stats`)

Production report: writing/recording status against the project ladders, the
voiced-vs-written line split, the burndown (done / to-write / projected), plan
coverage, cut content, character rollups, and localisation staleness. Prints a
compact summary by default.

| Option | Meaning |
|--------|---------|
| `--xlsx <file>` | Also write a polished spreadsheet (Scenes / Characters / Localisation / Plan). |
| `--json` | Emit the full structured report as JSON on stdout (for pipelines). With `--xlsx`, the "wrote" note goes to stderr so stdout stays pure JSON. |

```sh
patter report
patter stats --xlsx report.xlsx
patter report --json | jq '.totals'
```

### `patter pack [path] -o <file.patterpack>`

Pack a project (the `.patter` folder) into a single portable **`.patterpack`** - a
binary zip envelope, the send-and-return artifact for collaborators without VCS
(you cannot email a folder; this is the zip of it). `-o` is required.

```sh
patter pack my-game.patter -o my-game.patterpack
```

### `patter unpack <file.patterpack> -o <dir>`

Explode a `.patterpack` back into source shards under `<dir>`. Both the input
file and `-o <dir>` are required. Entry paths that would escape the target
directory are rejected.

| Option | Meaning |
|--------|---------|
| `--merge --base <sent.patterpack>` | Instead of extracting, **fold a returned document's edits back into the existing project** at `<dir>` via the 3-way merge engine. `--base` is the `.patterpack` you originally packed and sent (the common ancestor). Per shard: a clean merge updates the file, a conflict writes a `.patterconflict` sidecar; a file only in the returned document is added. Exits non-zero if any shard conflicts. |

```sh
patter unpack returned.patterpack -o ./my-game.patter --merge --base sent.patterpack
```

### `patter merge BASE OURS THEIRS`

Domain-aware **3-way merge** of Patter source by node id (not by line), for all
four shard types (flow / loc / authoring / project). The merged output is always
valid canonical source; conflicts resolve provisionally to OURS and are listed
in a `.patterconflict` sidecar. Mostly invoked by your VCS via `mergetool`, but
usable directly.

| Option | Meaning |
|--------|---------|
| `-o <file>` | Write the merged result to `<file>` (+ `<file>.patterconflict` on conflicts). Without it, the merge streams to stdout. |
| `--type <t>` | Force the type (`flow`/`loc`/`authoring`/`project`); default auto-detects from the `schema` tag. |
| `--json` | Emit the structured `{ type, merged, conflicts, warnings }` as JSON. |

Exit: `0` clean, `1` conflicts (sidecar written), `2` error. `%O %A %B` from a
git driver map to BASE OURS THEIRS.

```sh
patter merge base.patterflow ours.patterflow theirs.patterflow -o ours.patterflow
patter merge base.patterloc ours.patterloc theirs.patterloc --json
```

### `patter mergetool BASE THEIRS OURS OUT`

The **VCS merge-tool wrapper** - register it once as your single global merge
tool. It sniffs the path: Patter source goes to the structured merge above;
anything else is handed to your normal tool. Arguments are in the BASE THEIRS
OURS OUT order that Perforce / Plastic / SVN all use; `patter init --vcs <x>`
writes the exact registration into `vcs-setup.md`. (git instead uses its
per-path driver and calls `patter merge` directly.)

| Option | Meaning |
|--------|---------|
| `--fallback <cmd>` | The tool to run for non-Patter files (e.g. `p4merge`, `"code --wait --merge"`). It receives the same four file arguments. |

```sh
patter mergetool $BASE $THEIRS $OURS $OUT --fallback p4merge
```

## File types

| Extension | Role | In VCS? |
|-----------|------|---------|
| `.patter` | The **project** folder (a macOS package; a plain folder elsewhere) | yes - it *is* the source tree |
| `.patterproj` | Project settings manifest (inside the `.patter`) | yes (source) |
| `.patterflow` | One flow / scene (the structural tree) | yes (source) |
| `.patterloc` | Localised strings, per scene per locale | yes (source) |
| `.patterx` | Authoring / production metadata (status, comments, estimates) | yes (source) |
| `.patterc` | Compiled runtime bundle (`export` output, strict JSON) | committed by default (see `--bundle`) |
| `.patterpack` | Packed portable send document (`pack` output, binary zip) | no - ignored, ephemeral |

Source files are UTF-8 + LF JSON5 (trailing commas allowed); `patter format`
keeps them canonical, and the VCS config from `patter init` pins encoding and
wires structured merge.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success. |
| `1` | The operation ran but found problems or failed (validation issues, a stalled playthrough, a write failure). |
| `2` | Usage error (unknown command, unknown flag, missing required value). |
