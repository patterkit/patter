---
title: Properties and game data
description: Declare the @patter, @scene, and @world properties the story reads and writes, and the Game Data your game reads back.
sidebar:
  label: Properties and game data
---

Two kinds of data flow through a Patter story, and as the project lead you define both.

Properties are the variables the *story* reads and writes (gold, reputation, whether the player
knows a secret). Writers test and set these in conditions and effects.

Game Data is the values the *game* reads back off each beat (an emotion, a camera angle, a
sound-effect id) to drive how it's presented.

This page is the setup side. Writers see the same features from their side in
[Conditions, effects & data](/patterpad/conditions-and-data/); the format-level model is
in [Game Data & addressing](/format/gamedata-and-addressing/).

## Properties: the story's variables

Declare `@patter` properties on the **Properties** page, the row at the top of the navigator above
your scenes, and `@scene` properties on the scene itself. Each has a **name**, a **type** (yes/no, number, text, a pick-list, a set of flags, or a
[**Quality**](/format/property-types/#quality-the-stage-of-a-story), an ordered ladder of stages),
and a default. Once declared, the editor offers them by name in the condition and effect
editors and checks every use: a writer can't compare a number against a word, or test a property
that doesn't exist.

| Scope | Lives | Use it for |
|---|---|---|
| **`@patter`** | Whole story, saved | Global state: `@gold`, `@reputation`, story flags. |
| **`@scene`** | One scene, saved | Bookkeeping local to a scene: `@scene.asked_about_work`. |
| **`@world`** | Your game owns it | Values the game sets while it runs: `@world.threat`, `@world.location`. |

A short, well-named property list is a kindness to writers: the condition editor stays easy to
use, and there are fewer ways to write a logic bug.

## `@world`: values your game owns

Some branches depend on things the *game* knows, not the story, such as the player's location,
a difficulty setting, or a live threat level. Declare those in **Project Settings ▸ World Properties**
as `@world` values (name, type, default, and whether the story is allowed to change them). Two
payoffs:

- The editor **checks** `@world.*` references, so a condition against a value your game feeds is
  validated like any other.
- While the game runs it **supplies** these values; if nothing sets them, the runtime falls back
  to the defaults you declared and saves them with the rest of the run (see
  [Save/load & Game Data](/play/integration/)).

One thing to know now is that because the game sets `@world` values while it runs, the editor's
[coverage test](/production/coverage-testing/) can't know them, so a branch gated on
`@world.threat` shows up as *needs input* until you give the test stand-in values. Those
stand-ins, **coverage drivers**, live in the same World Properties tab and are covered with
the test itself under [Input drivers](/production/coverage-testing/#input-drivers).

## Sharing scopes with the game's other tools

A game can have more than one editing tool in it: Patter for conversations, the Storylet Engine's
Storyletter for storylets, and others. Each can name the others' properties (a Patter condition on
`@story.act`, a storylet testing `@patter.met_the_guard`), and each can check those names if the
game keeps one **`game-scopes/`** folder where every tool writes what it declares:

```
my-game/
  game-scopes/
    patter.scopes.json      written by Patterpad and the patter CLI
    storylets.scopes.json   written by Storyletter and the storyletengine CLI
    game.scopes.json        the game's own scopes (@world, and any others)
  story/the-village.patter/...
```

- **Patter's file** holds the project's shared `@patter` properties (per-flow ones are not
  game-wide, so they stay out). Patterpad writes it whenever the properties are saved, and on a
  build; `patter export` writes it too. It changes only when the declarations do, so it sits in
  version control beside the project without churn. `patter validate` warns when it is out of date.
- **Other tools' names are checked, with warnings.** A name another tool's file doesn't declare,
  a comparison of the wrong type, or a write to a property that file marks read-only is a
  warning, never an error, because the other project may be a save behind on someone's branch. A
  token nobody declares is accepted unchecked, as it is without a folder. The condition and effect
  editors offer the other tools' properties by name, with who declares each in the tip.
- **The game's own scopes live in `game.scopes.json`.** With the folder, **Project Settings ▸ World
  Properties** edits that file (and leaves the scopes it doesn't show alone), and the project keeps
  a copy, so it still compiles packed or checked out on its own. The shared file wins: if the two
  ever differ, `validate` says so. Its `@world` is compiled into the bundle, so a game running
  Patter alone still starts from those defaults.
- **Previews stand the other tools in.** The Play window, `patter play`, and coverage runs play a
  line that names `@story`, reading the defaults the Storylet Engine's file declares. A real game
  still needs the other engine on the same registry (see
  [One registry per game](/play/integration/#one-registry-per-game)).

Patter finds the folder by walking up from the project to the first `game-scopes/`, stopping at
the root of your version control, so a folder above your repository is never picked up. To keep
it somewhere else, name it in the project file, relative to it:

```json5
gameScopes: "../../shared/game-scopes",
```

A **`.patterpack`** carries a read-only snapshot of the folder, and unpacking puts it in
`game-scopes/` inside the new project folder, so the person you sent it to has the same checks,
pickers, and previews. Merging their pack back never writes that snapshot anywhere: your folder
stays the truth. If they changed World properties, the merge writes their change to your
`game.scopes.json` and tells you so (see
[Handing the project to someone](/setup/building-and-shipping/#the-games-shared-scopes-travel-too)).

A project with no folder works alone, exactly as before. **File ▸ Share Scopes with Other Tools**
creates the folder (at your version-control root, unless you choose another place) with Patter's
file and a `game.scopes.json` holding your World properties. An `@story` you imported under World
properties before the folder existed is superseded once Storyletter writes its file there, and
`validate` asks you to remove it.

## Game Data: what your game reads back

Properties drive the *story*; **Game Data** hands cues to the *game*. In **Project
Settings ▸ Game Data**, decide what fields each kind of beat can carry: for example, an `emotion`
pick-list on **line** beats, a `camera` field on **text**, an `sfx` id on a **game event**. Each
field has a name, a type, and a default.

Writers then see only the fields that apply to the beat they're on, and fill them in from the
inspector. A beat only stores the fields you actually change, so adjusting a default updates
everywhere you left it alone. While the game runs it reads these off each beat in one call,
merged with the defaults (see [Save/load & Game Data](/play/integration/)). This is how a
story tells your game "play this line *angrily*, with the camera *close*" without ever naming
your game in the script.

> **Properties vs Game Data, in one line:** properties are things the story *changes*; Game Data is
> notes the game *reads*. Use a property when a later beat needs to test it; use Game Data when
> only the game cares.

## Tags

For lighter, freeform labelling, writers can add **tags** to beats and structure (`#flashback`,
`#tutorial`). A tag on a scene or group counts for everything inside it, and every tag reaches
your game as the beat plays: no setup, nothing to declare. They're ideal for marks that cut
across the story and don't warrant their own field.
[Game Data & addressing](/format/gamedata-and-addressing/) has the rules for tags.
