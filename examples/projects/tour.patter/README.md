# The Patter Tour

An interactive walkthrough, written **as a playable Patter project**. A friendly guide takes you
through Patter's features and lets you *try* them: choices that gather, the three selectors (shuffle,
sequence, branch), properties and conditions, closed captions, and explains the parts you can't see
just by reading (tags, gameData, save/load, localisation, the four runtimes, the editor's safety nets).

It's a hub-and-spoke story: a central crossroads with a sticky menu, each topic jumping out and back, so
you can explore in any order and revisit anything.

## Play it

- **In Patterpad**: open `tour.patter`, then **Play ▸ Play from Start** (`⌘P`). Toggle the **CC** button
  in the play window to watch the captions section change.
- **From the terminal**: `patter play examples/projects/tour.patter` (add `--choices ho_sel,so_shuffle,...` to
  steer), or `patter export-html examples/projects/tour.patter -o tour.html` for a single playable HTML file.

## What it demonstrates

| Topic block | Feature shown |
| --- | --- |
| Lines & narration | `line` vs `text` beats, performance directions |
| Choices & gather | a choice that branches and **gathers** back; once-only / repeatable / fallback |
| Selectors | `shuffle` (random draw), `sequence` (looping), and `branch` (first sub-node whose **condition** passes: an if/else-if/else ladder), poked live via sticky options |
| Memory | a `@number` property bumped by an **effect** + `{@asks}` interpolation; a `@boolean` read by a **condition** |
| Closed captions | a `[cue]` inside a line and a whole `SFX` line, stripped when captions are off |
| Under the hood | tags, gameData, save/load, localisation, the four runtimes, editor checks |

The whole thing is a folder of plain JSON shards: the same format every Patter project uses.
