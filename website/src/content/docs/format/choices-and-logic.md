---
title: Choices & logic
description: Selectors, choices and options, conditions, effects, properties, the expression language, and embedding property values in text.
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
  - **order**: `sequential` (the default), `shuffle`, or `specificity` (**Best match**, below);
  - **exhaust**: `once` (the default), `repeat`, or `stick` (hold on the last child).

  Shuffle deals from the pack without repeats, and never plays the same line twice in
  a row: that's built in, not an option. The `sequential` and `shuffle` combinations cover
  the usual "each line once", "cycle", "random with no repeats", and "stop on the last"
  patterns; `specificity` is the state-aware one, and gets [its own section](#best-match-lines-that-fit-the-moment).
- **`choice`**: offer all children as options and wait for the player. This is the one
  selector that does **not** filter on conditions; it hands ineligible options to your
  game marked **unavailable** instead (see below).

A sequence's memory can be **shared** across [flows](/concepts/#flows) rather than kept per-flow, so two
characters never draw the same shuffled line, or a `once` is spent for everyone the
first time it runs.

## Best match: lines that fit the moment

`sequence` with **order `specificity`** (shown as **Best match** in Patterpad) is the selector for
lines that should *comment on the exact situation*, and quietly fall back to something generic when
nothing more specific applies. In one sentence: **among the children whose conditions currently
pass, play the one whose condition is the most specific to the present state; reach for a generic
filler only when nothing more specific is eligible.**

### What it's for

Reactive one-liners - barks, ambient chatter, greetings - that feel canned if they ignore the
state, and are laborious to hand-branch if you write an `if` for every combination:

- **Companion banter** that reacts to what just happened: "You're bleeding, here, take this" when
  the player is hurt *and* the companion has a potion; "Careful, it's slippery" when it's raining;
  a plain "Keep moving" when nothing special is going on.
- **A guard** who notices what you carry: a line for the stolen crown, a line for *any* drawn
  weapon, a generic "Move along" for everyone else.
- **A shopkeeper** whose greeting tracks your reputation or quest stage: the further along you are,
  the more specific the line they have for you.
- **Tiered filler**: three lines for the exact circumstance, two for the broad one, one catch-all.

You write the specific lines and the filler, each with its condition, in one group; Best match picks
the right tier every time, with no hand-built decision tree.

### How it decides (the specificity score)

Each eligible child gets a **specificity score**: roughly, *how many separate conditions are
actively holding it true right now*. The highest score wins. A child with **no condition scores
zero**, so it is the filler; it only wins when nothing more specific is eligible. When children
tie, Best match breaks the tie with the same seeded shuffle as `shuffle`, so it stays reproducible
and never repeats a line back-to-back.

Walking a condition to score it:

- `and` **adds** its two sides (both must hold, so both count).
- `or` takes the **stronger** side (only one side is carrying the truth).
- `not` flips the sense and looks inside.
- `check_flags(@q, +a, +b)` counts **each flag** it checks.
- anything else - a comparison, a property, a `visits()` check - counts as **one**.

| Condition (all currently true) | Score |
|---|---|
| *(no condition)* | 0 |
| `@hurt` | 1 |
| `@hurt and @hasPotion` | 2 |
| `check_flags(@quest, +metCaptain, +hasCrown, +nightfall)` | 3 |
| `@rich or @generous` | 1 |

So a group holding `@hurt and @hasPotion` (2), `@hurt` (1), and a no-condition filler (0) plays the
first line when the player is hurt and the companion has a potion; the second when hurt but
empty-handed; and the filler otherwise.

### Repeating vs using lines up

Best match composes with the sequence **exhaust** setting:

- **`repeat`** (Patterpad's default for Best match): re-score and re-pick every time the group is
  reached, so the character keeps preferring the most on-topic line as the state changes. This is
  what you want for barks and ambient chatter.
- **`once`**: each line is used up as it plays, so the group **slides down** the tiers, the most
  specific first, then the next, and finally the filler. Good graceful degradation for a set of
  first-time lines that shouldn't repeat.

### Writing one

Put the **specific lines first and the general ones last**, each with its condition, and leave
**one child with no condition** as the filler at the end. You don't have to make the conditions
mutually exclusive - that's the point: overlapping conditions are fine, the most specific eligible
one wins, and the filler catches the rest. (A Best-match group with *no* conditions at all just
behaves like `shuffle`; Patterpad points that out.)

### Every engine agrees

The score is a pure function of the condition and the current state, and ties use the shared seeded
shuffle, so a Best-match group plays **identically on all four runtimes** (JavaScript, Unity,
Unreal, Godot), the same as every other selector. It is locked by the conformance corpus.

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

## Embedding property values in text

You can drop a live game value straight into a beat's text by wrapping a property
reference in braces (sometimes called *interpolation*). At runtime the braces are
replaced with the property's current value:

> `You have {@gold} gold.`  →  `You have 42 gold.`

- The body is a **bare property reference** - the same `@` reference you'd use in a
  [condition](#conditions-and-effects): a project property `{@gold}`, a scene property
  `{@scene.threat}`, a host value `{@world.faction}`. It's a reference, not a formula:
  you can't write `{@gold + 1}`.
- Only a `{…}` whose body starts with `@` is a slot. To print a literal brace, double it:
  `{{` shows as `{`.
- Values render as you'd expect: a number or string as-is, a true/false property as
  `true` / `false`, a flags set as a comma-separated list. An unset property shows as
  nothing. A `{@…}` naming a property you haven't declared is flagged as an error.

### Where it works: the voiced-project wrinkle

| Text | Embedding a value |
| --- | --- |
| **Narration** (`text` beats) | always |
| **Choice options** | always |
| **Dialogue** (`line` beats) | **only when the project is not voiced** |

Narration and choice options are always on-screen, so a value can always be substituted in.

Dialogue is the exception, and it comes down to whether the project is
[**Voiced**](/patterpad/projects-and-settings/). A voiced line ships as **recorded audio**,
and you can't splice a runtime value into a fixed recording - so **a voiced project rejects a
`{…}` slot in a dialogue line, as a build error**. If the project is **not** voiced, its
dialogue is just on-screen text like narration, so embedding works there too.

Put simply: narration and choices always; spoken lines only when there is no voice audio to
contradict them. If you switch a project to Voiced later, any `{…}` already sitting in a
dialogue line will surface as a build error to clean up.
