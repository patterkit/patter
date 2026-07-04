---
title: Choices & logic
description: Selectors, choices and options, conditions, effects, properties, and the expression language.
sidebar:
  label: Choices & logic
---

This page is about how a Patter scene *decides*: which children of a group play, what
the player picks from, and the conditions, effects, and properties behind it all.

## Selectors

A group's **selector** decides what happens with the children whose conditions pass:

- **`run`** (the default): play every eligible child in order.
- **`branch`**: play the first eligible child, and stop. This is your if / else-if /
  else, and your switch: ordered children with conditions, most specific first, and an
  unconditional last child as the "else".
- **`sequence`**: a picker that remembers where it is, with two independent settings:
  - **order**: `sequential` (the default) or `shuffle`;
  - **exhaust**: `once` (the default), `repeat`, or `stick` (hold on the last child).

  Shuffle deals from the pack without repeats, and never plays the same line twice in
  a row: that's built in, not an option. The six combinations cover the usual "each
  line once", "cycle", "random with no repeats", and "stop on the last" patterns.
- **`choice`**: offer all children as options and wait for the player. This is the one
  selector that does **not** filter on conditions; it hands ineligible options to your
  game marked **unavailable** instead (see below).

A sequence's memory can be **shared** across [flows](/concepts/#flows) rather than kept per-flow, so two
characters never draw the same shuffled line, or a `once` is spent for everyone the
first time it runs.

## Choices and options

Under a `choice`, each child is an **option**: a container with a required **prompt**,
an optional **condition** and Game Data, a few flags, and the **content** that plays
when the player takes it (anything from a single line to a whole subtree).

The **prompt** is exactly one beat (a line or text), handed to your game as-is. Patter
doesn't look ahead or guess: the prompt is the choice text, full stop. An empty prompt
is allowed, so your game can draw the option from Game Data or an icon instead.

### The flags

- **`secretUntilEligible`** (default false): while its condition fails, the option is
  kept out of the data your game receives entirely, so it can't leak through a save.
  This is about *secrecy*, not rendering.
- **`sticky`** (default false): off means **once-only**: after the player takes it, it
  is gone from the choice for good. On means it stays available as long as its
  condition passes. (This rides the option's visit count, so it survives save and
  restore for free.)
- **`fallback`** (default false, at most one per choice): never offered as a normal
  option; taken automatically the moment it's the only eligible option left.

### Unavailable, not hidden

By default an ineligible option is still returned to your game, with its text and an
`eligible: false` flag (plus the reason it failed). How to present it is entirely your
game's call: dim it, show a lock, spell out the requirement, or leave it out. For
example, a persuade option gated on `@charisma >= 6` can be shown to a low-charisma
player as "[Charisma 6] Talk them down", so they see the path they *could* have taken;
the runtime simply won't let them pick it. Reach for `secretUntilEligible` only when an
option has to stay truly invisible, so it can't even leak through a save.

If no normal option survives and there's no eligible fallback, the choice simply
**gathers**: the flow carries on past it. A re-enterable choice with no sticky option
and no fallback gets a `choice-can-empty` warning from the validator.

## Conditions and effects

- **Conditions** decide whether a snippet or group (or a conditional jump) is eligible.
  Leave one off and it's always eligible.
- **Effects** are ordered lists that run at a snippet's seam: `onEnter` / `onExit` on a
  snippet, `onEntry` on a scene. An effect does **one thing and one thing only**: it
  sets a property to the result of an expression. There's no way to fire an event from
  an effect; host events ride on
  [Game Data](/format/gamedata-and-addressing/) instead.

## Properties

Properties are the game state your logic reads and writes, and the state a runtime
hands to the host.

- **Scope**: `@patter` (global; created at the start, lives forever, visible
  everywhere) and `@scene` (local to one scene, but still kept for the life of the
  piece). A bare `@name` means `@patter.name`. There's no block- or group-local scope.
- **Types**: `boolean`, `number`, `string`, `flags`, and `enum` (flags and enum behave
  like Ink LISTs).
- **Sharing**: a per-property `shared` flag controls *where the value lives*: one value
  for the whole world, or one per concurrent flow. `@patter` is shared by default;
  `@scene` is per-flow by default. The two are independent, so you can have a
  flow-private global or a shared scene property.
- **`temporary`**: a per-flow `@scene` property can be reset to its default every time
  the scene is entered ("fresh each visit", Ink's `temp`).

**Visit counts** are derived and read-only. `visits(node)` / `seen(node)` give this
flow's entered-count for a node id; `patter_visits()` / `patter_seen()` give the count
across the whole world. A node counts as "entered" when its condition passes and it's
selected.

## The expression language

Conditions, effects, and value expressions are written in a small, type-aware
expression language. A writer in Patterpad **never types this by hand**: the
[visual expression editor](/patterpad/conditions-and-data/#conditions) builds it
from pills (a property, a comparison, a value) and stores the result. The language below is
what that editor produces and what the format keeps on disk, useful to know if you're reading
files or building tooling, not something an author has to learn:

- **Property references**: `@name`, `@patter.name`, `@scene.name`.
- **Operators**: comparisons, boolean logic (`&&`, `||`, `!`), and arithmetic, over
  numbers, booleans, strings, and string arrays (flags).
- **Built-in functions**: `seen()` / `visits()` (and their world-wide `patter_` forms),
  `random(a, b)` (a whole number from `a` to `b` inclusive, drawn from a seeded
  generator so every engine gets the same result), and the flag helpers
  `check_flags(@prop, +x, -y)` / `set_flags(...)`.

### Interpolation

A `text` beat (and any non-voiced line) can drop a property value into the text with
`{…}`, where the body is a bare property reference: `You have {@gold} gold.` Only a
`{…}` whose body starts with `@` counts as a slot; to write a literal brace, double it
(`{{`). Voiced lines never interpolate: they have to stay fixed so they can be recorded.
