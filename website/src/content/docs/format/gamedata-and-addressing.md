---
title: Game Data & addressing
description: Author-defined typed data on every node, and the two IDs Patter uses to address content.
sidebar:
  label: Game Data & addressing
---

## Game Data

**Game Data** is Patter's built-in extension point: the clean hook for everything the
format doesn't model itself. Where Ink has loose `# tags`, Patter has typed fields you
define up front.

1. **Define the fields once.** In the project, you define fields grouped by node type
   (scene, block, snippet, line, text, game event). Each field has a name, a type
   (`text`, `multiline`, `number`, `boolean`, or `enum`), a default, an optional set of
   enum values, and a note on what it's for.
2. **Fill in values per node.** Any node (a scene, block, group, snippet, jump, or
   beat) can carry a `gameData` map, and it only stores the values that *differ* from
   the field default. A reader fills in the rest from the defaults as it reads. Change a
   default and every node that didn't override it follows along.

The runtime never looks inside Game Data: to Patter it's just opaque data, and it's
entirely yours. Your host reads it off each beat to drive audio, camera, portraits,
quest state, whatever you need.

### Game Data is where host events live

Because [effects can only set properties](/format/choices-and-logic/), "do this
now" instructions (play a sound, trigger a cutscene, advance a quest) aren't effects.
They're **Game Data your host reads when the beat plays**, most often on a dedicated
**game event** beat, which has no visible words and exists for exactly this. Your game
looks at `step.gameData` and acts.

## Tags

Where Game Data is typed and defined up front, **tags** are the freeform counterpart:
plain labels you can attach anywhere, with no setup step. Any node can carry an
optional `tags: string[]`: a scene, block, group, snippet, or beat. A tag is any text
with **no spaces and no comma**, and each node's list is de-duplicated.

Tags **build up down the structure** at runtime. A beat's effective tags are its own
plus every ancestor's, ordered outermost-first with duplicates removed:

```
scene  ["act1"]
└ block  ["hub"]
  └ snippet  ["intro"]
    └ beat  ["barked"]   →  step.tags = ["act1", "hub", "intro", "barked"]
```

Every delivered `line` / `text` / `gameEvent` step carries its built-up `tags` (left
out when empty), and the engine offers `tagsForBeat(id)`, `tagsForScene(scene)`, and
`tagsForBlock(scene, block)` so a host can ask about a level directly. See
[Tags at runtime](/play/tags/) for the API. Unlike
authoring-only notes, tags are compiled into the bundle, so they ship to the runtime.

## The two IDs

Patter gives content two different identifiers, each with its own job:

- **The line `id`**: each line and beat has a short, stable **id** like `L_0n7vdq42`. You
  never write it, it's assigned for you (the inspector shows it as a small, copyable
  `#id`), and it's **fixed**: never based on the wording or where the line sits, so it
  **survives editing, moving, renaming, and re-ordering**. Change a line's words, drag it
  to another block, its `id` doesn't change. It's the key that a line's
  **[localisation](/production/localisation/) string, its
  [audio](/production/audio/#recording-status) file, and its place in a save** all
  join on, which is *why* it can't encode location: if it changed when you moved a line,
  the translation and the recorded take would be orphaned. A game that needs to react to
  one *specific* line watches for its `id`.

- **The `gameId` (address)**: an author-editable, host-facing address on a **scene or
  block** ("play this scene", "jump to this block"). It's a readable slug, taken from the
  name until you set a fixed value. Scene addresses are unique across the project; block
  addresses are unique within their scene. Renaming an address never breaks a jump that
  points at it.

So: a line's **`id` is its stable identity** (what localisation, audio, and saves key
off); a **`gameId` is an address** your game code aims at to start or jump to a scene or
block. The runtime can also hand a `gameId` back for display and logging: see
[the Engine API](/play/engine/).

### Finding the line an `id` refers to

Because the `id` gives nothing away on its own, you'll sometimes have one in hand,
from a locale table, an audio filename, a coverage report, or a runtime log, and need
to know *which line it is*. Both tools resolve it instantly:

- **In Patterpad**, open search (**⌘F** / **Ctrl-F**) and paste the `id`. The matching line
  is listed with its text and its scene › block location; press **Enter** to jump straight
  to it. See [Search and navigation](/search/).
- **From the command line**, `patter resolve <id>` prints the kind, location, and the line's
  text, and it accepts a `gameId` or a scene/block name too. See [the CLI](/cli/).
