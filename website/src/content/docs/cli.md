---
title: The patter CLI
description: Validate, format, compile, play, localise, and merge Patter projects from the terminal.
---

The **`patter`** CLI runs the same operations the editor does, so what you author and
what you automate never drift apart. It's the natural fit for gating a pull request,
running a build, or scripting a localisation hand-off.

```sh
npm install -g @patterkit/cli
patter validate ./my-project.patter
```

Every command writes through your version control (checking a file out first, adding
new files), so a locked or read-only file fails the write rather than being
overwritten. **Exit codes** are consistent: **0** success · **1** the operation found
problems or failed · **2** a usage error. `fmt` is an alias for `format`, and `stats`
for `report`.

## Authoring & validation

### `patter init [dir]`
Scaffold a new project: `<dir>.patter` with a starter scene and VCS config.
`--name X` · `--vcs git|perforce|plastic|svn` · `--bundle commit|ignore`. (`init .`
in place stays a plain folder.)

### `patter validate [path]`
Check structure, expressions, interpolation, encoding, a stale bundle, and unresolved
merges. Exit **1** if anything is wrong: the command to gate a PR on.

### `patter format [files…]` (alias `fmt`)
Rewrite source to canonical form. `--check` reports what *would* change and writes
nothing, exiting **1** if anything differs: a CI formatting gate.

## Build & play

### `patter export [path] [-o file]`
Compile to a `.patterc` bundle (a single JSON file). Defaults to the project's configured
output, else `dist/<name>.patterc`; `-o -` writes to stdout. `--ids` builds an
IDs-only bundle (ships no strings); `--source-debug` is IDs-only but embeds the source
language for debug playback.

### `patter export-script [path] [-o file.pdf|.docx]`
Export a **readable screenplay** of the script + flow: dialogue, narration, choices (with their
conditions / flags), and jumps, in reading order. Format follows the extension; default
`dist/<name>.pdf`. PDF uses built-in fonts (Latin / Western-European); use `.docx` for full
Unicode. → [Building & shipping](/setup/building-and-shipping/)

### `patter export-html [path] [-o file]`
Export a single self-contained, **playable** `.html`: the runtime, the whole story, and
a reader UI inlined, so it plays offline in any browser with no server. Hand one file to a
stakeholder. Defaults to `dist/<name>.html`; `-o -` writes to stdout. Reads in the project's
source language. → [Building & shipping](/setup/building-and-shipping/)

### `patter play [path]`
Run the story through the reference runtime **non-interactively** and print a transcript, for
scripted checks and CI, not for exploring (to actually play through a story, use Patterpad's Play
window). Choices come from `--choices a,b,c` (option ids taken in order; otherwise the first
eligible is picked). `--scene id` · `--block id` · `--seed N`. Exits **1** if the playthrough
didn't reach the end: a completion gate for CI.

### `patter coverage [path]`
Narrative coverage: play the story many times with random choices and tally how often each
beat is reached, flagging never-reached content. `--runs N` · `--max-steps M` · `--seed S` ·
`--scene id` · `--block id`. `--json` for pipelines; `--fail-on-gap` exits **1** if any beat
is never reached (a CI gate). `--propose` prints auto-proposed `@world` input drivers instead
of running. The same check has a window in Patterpad (**Review ▸ Run Coverage Test…**).

### `patter resolve <query> [path]`
Find the line (or node) a query names and print where it lives + what it says. The query can be an
opaque **`id`** (e.g. from a locale string, an audio filename, or a runtime log), a **Game ID** address,
or a scene/block **name**. Each hit prints `id  [kind]  Game-ID  Scene > Block  «text»  (file)`, so an
an id resolves straight to the line it refers to.

### `patter usage <query> [path]`
Find every node that references a property: in a **condition**, an **effect**, or **interpolated
text**. Handy when coverage flags a dead branch and you want to know where else its gating property is
used. The query is a property ref (`@gold`, `world.threat`); add a value to narrow the matches, quoting
it as one argument (`"faction rebels"`). `--json` emits the hits for scripting.

## Production & localisation

### `patter report [path]` (alias `stats`)
A production report: status, burndown, recording coverage. `--xlsx file` also writes
a spreadsheet; `--json` emits JSON to stdout (for pipelines). In an **Audio Folders**
project, recording status is derived from the takes on disk - the same numbers Patterpad
shows.

### `patter loc-export [path] -o file`
Export strings for translation. `--format json|xlsx|po` (required) · `--locale xx`
(omit for a blank template / POT). Each string carries its translator context, including
the speaker's [grammatical
gender](/production/localisation/#who-is-speaking-grammatical-gender).

### `patter loc-import <file> [path]`
Import a translated file back; the format is read from the extension, and `--locale xx`
overrides the file's locale.

### `patter voice-export [path] -o file.xlsx`
A voice-recording script. Requires a **Voiced** project (`voiced: true`), or it exits with an
error. `--all` includes every voiced line (otherwise only those ready to record). In an
**Audio Folders** project, each line's status column is derived from the takes on disk.

## Sharing & merging

### `patter pack [path] -o file` / `patter unpack <file> -o dir`
Pack a project into a portable `.patterpack`, or explode one back into source shards.
`unpack --merge --base sent.patterpack` folds a returned pack's edits into the project
(a 3-way merge using `--base` as the common ancestor).

### `patter merge BASE OURS THEIRS`
A 3-way structural merge of Patter source **by node id**. `-o out` (otherwise stdout)
· `--type flow|loc|authoring|project` (otherwise auto-detected) · `--json`. Conflicts
write a provisional result plus a `.patterconflict` sidecar and exit **1**.

### `patter mergetool BASE THEIRS OURS OUT`
A version-control merge-driver wrapper: Patter source goes through the structured
merge, and anything else is handed to your normal tool via `--fallback cmd`. One driver
serves the whole repository.
