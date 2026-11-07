---
title: Example game types
description: See how Patter slots into eight kinds of game, from visual novels to roguelikes, and which problems it solves in each.
sidebar:
  label: Overview
---

These pages take eight kinds of game and show how Patter slots into each one: the dialogue problems that kind of
game runs into, and how Patter solves them. They're a starting point for planning, not a tutorial. Each problem
links to the page that has the detail.

## What Patter does, and what your game does

Patter is about dialogue: the lines, the choices, and the state that goes with them. In every kind of game it
does the same three things.

- **It holds the writing.** Scenes, lines, and choices, written in Patterpad and played by the same runtime on
  JavaScript, Unity, Unreal, and Godot.
- **It keeps the dialogue's state.** What's been said, what the player picked, the flags and values the
  conversations set, and the variation lists that remember where they are.
- **It shares state with your game.** The game reports what the dialogue needs to know, such as the time, the
  quest stage, or what the player is carrying, as [`@world` properties](/play/world-properties/). The dialogue
  reads them, and where you allow it, changes them, and your game acts on the change.

Everything else is your game's. It shows the text, plays the audio, moves the camera, and runs every system of its
own: the puzzles, the quests, the combat, the inventory, the simulation, and the saving. Patter never runs those.
It reads their results, and the dialogue follows them.

[Game Data](/format/gamedata-and-addressing/) is how the writing hands cues to the game: an expression on a
line, a camera on a cutscene, a sound on a game event. The game reads them as each beat plays.

:::tip[Coming soon]
Upcoming Patter extensions will help marshal conversations in your engine, drive lipsync, and manage their
integration with cutscene animation. They'll help most in point and click adventures, linear action games, RPGs, walking sims,
and roguelikes.
:::

## Where Storylet Studio fits

[Storylet Studio](https://storylets.dev) is Patter's sibling, built for storylets: pieces of story with a
condition on the front, dealt to the player when they fit. You don't need it. It earns its place when the game
has to choose which scene comes next from a pool, as the world changes: tonight's event, the next rumour, which
character turns up. Storylet Studio picks the beat, and Patter performs it, with both reading the same game state
([Running it with Patter](https://storylets.dev/play/with-patter/) shows how they join). Each page says
whether it's worth adding.

## The game types

- [Visual novels](/game-types/visual-novels/): routes, relationships, endings, and presentation on every line.
- [Point and click adventures](/game-types/point-and-click/): look, use, and talk on every hotspot.
- [Linear action games](/game-types/linear-action/): cutscenes, briefings, radio, and barks.
- [RPGs](/game-types/rpgs/): quest givers, reputation, companions, and a large voiced cast.
- [Detective and mystery games](/game-types/detective-and-mystery/): interviews that open up as evidence
  turns up.
- [Management and sim games](/game-types/management-and-sim/): story events from the simulation.
- [Walking sims and audio-log games](/game-types/walking-sims/): narration and found recordings.
- [Roguelikes](/game-types/roguelikes/): lines that react to runs and deaths without repeating.

For a first story in a browser, [Make an interactive story for the web](/web-story/) builds a small player
step by step.

## When Patter isn't the right tool

- **Text built from fragments.** Patter can run a text game, with simple values dropped into the text, but its
  unit is the dialogue line. If your game combines and generates its text from fragments, use
  [Ink](https://www.inklestudios.com/ink/), which is built for that.
- **Multiplayer.** None of Patter is designed or tested for more than one player. [Why Patter](/why/) has the
  rest of the list.

## How the sketches are written

Each page has short script sketches, shown the way Patterpad shows them.

- A line is `CHARACTER: text`.
- A choice's options start with `>`. An option's own condition and flags follow it in brackets on the same
  line, as in `> Who's J.M.?  (if @patter.saw_initials)`, and decide whether it's offered.
- Other notes, on conditions, selectors, effects, jumps, and Game Data, are in brackets on lines of their own.
  A condition or selector comes before what it applies to. An effect, or a line's Game Data, follows the beat it
  belongs to, indented under it.
