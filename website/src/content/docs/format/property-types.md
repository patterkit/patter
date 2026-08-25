---
title: Property types
description: The six kinds of state a Patter story can hold - boolean, number, string, enum, flags and quality - what each is for, and how to tell the confusable pairs apart.
sidebar:
  label: Property types
---

Every property you declare has a type. Six of them cover everything a story needs to
remember, and most of the work is recognising which one a piece of state actually is.
Two pairs are easy to mix up, so they get most of this page: **enum against flags**
(one of these, or any of these) and **flags against quality** (facts against stages).

Where you declare a property matters as much as its type. The scopes (`@patter`,
`@scene`, and your game's own `@world`) are covered in
[Properties & game data](/setup/properties-and-data/); this page is only about types.

## The six types

| Type | Holds | Example |
|---|---|---|
| `boolean` | true or false | `has_key` |
| `number` | any number | `gold`, `reputation` |
| `string` | free text | `player_name` |
| `enum` | exactly one of a fixed list | `weather`: clear, rain, storm |
| `flags` | any number of named facts, in any combination | `rel_anna`: met, warm, owes_favour |
| `quality` | exactly one stage of an ordered ladder | `investigation`: unaware, suspicious, certain, confronted |

In Patterpad these are the choices on each row of **Settings ▸ Properties**: True / False,
Number, Text, List, Flags and **Stages**.

## Boolean, number, string

Reach for these when the answer is obvious. A boolean is one fact that is either true or
not: `has_key`, `door_open`. A number counts or measures: `gold`, `reputation`,
`nights_survived`. A string holds text the player or the game supplied, like a name you
drop into dialogue with `{@player_name}`.

The trap is the number that is not really a number. If nothing ever does arithmetic on
it, and its gates are all comparisons against the same two or three landmarks, it wants
to be a quality. More on that below.

## Enum: one of these

An enum's value is exactly one of a list you fix in advance. The weather is clear or
raining or storming, never two at once, and never `drizzle` unless you added `drizzle`.

Why bother, when a string would hold the same word? Because the list is checked. Write
`@weather == "rein"` and Patterpad's problem bar names the typo before you ever play it.
A string would have accepted it and quietly never matched, which is the kind of bug that
survives to release: a condition that is merely never true looks exactly like a branch
nobody has reached yet.

Use an enum when the states are **mutually exclusive and unordered**: the weather, a
chosen faction, which of three endings a scene took.

## Flags: any of these

A flags property holds a set of named facts, any number of them at once, in any
combination. Writers test them with the **Check flags** clause and set them in effects;
on disk that is `check_flags(@rel_anna, +warm)` and `set_flags(@rel_anna, +owes_favour)`.

Nothing is implied about order. A character can be `warm` without being `met` if your
story allows it, and one line can ask about a single flag while ignoring the rest.

Use flags when the facts **accumulate independently**. Relationships are the classic case
in dialogue: met, warm, owes you a favour, saw you lie. So is a set of clues, or the
places a character has been told about.

**Enum or flags?** Ask whether two of them can be true at once. If yes, flags. If the
property can only ever be one of them, enum.

## Quality: the stage of a story

A quality is an **ordered ladder of named stages**, and its value is always exactly one
of them:

```
investigation: unaware → suspicious → certain → confronted
```

The order is the point, so conditions can ask about position rather than listing names:

- `@investigation == "suspicious"` means exactly there
- `@investigation >= "suspicious"` means at that stage or past it
- `@investigation < "confronted"` means not that far yet

and an effect moves it with `advance(@investigation)`: one rung, without naming where it
lands. It stops at the last stage rather than wrapping or erroring.

Use a quality for the spine of an arc: the thing that only moves forwards, one step at a
time. A suspicion that deepens, a negotiation that progresses, a siege that tightens.

### Why not just a number?

This is the most common shape a quality replaces. Suspicion as a number, gated like this:

```
@suspicion >= 2
@suspicion < 2
```

Two. Nothing on that line says what two *means*, so to change anything you first read
every effect in the project to work out what counts and how high it goes. The same gates
as a quality:

```
@investigation >= "certain"
@investigation < "certain"
```

Same behaviour, but the condition now says what the story is doing, a stage name that
does not exist is an error where a wrong number never could be, and `advance()` replaces
`+ 1`, so nobody has to remember the ceiling.

### Why not just an enum?

An enum can hold the same four words. What it cannot do is compare them. With an enum,
"at the confrontation or past it" has to be written out as
`@investigation == "certain" or @investigation == "confronted"`, and every time you add a
stage you must find and extend every one of those lists. A quality asks `>= "certain"`
and keeps working.

So: **enum for a state, quality for a stage.** If asking "or past it" makes sense, it is
a quality.

### Insertion safety, and why it matters more in a voiced project

Because no effect names its destination, you can add a stage to the middle of a ladder in
production and every existing line still works: play routes through whatever the ladder
now says comes next, and saved games carry on, because a quality is stored as its stage
**name**, not as a position.

That is worth more in Patter than in most places. By the time you want a new beat in the
middle of an arc, the lines around it may be recorded, translated, or both. Insertion
safety means the new stage costs you the new lines and nothing else: no sweep through
existing conditions, no re-cut of numbers, no re-recording of a line whose gate moved.

## Facts are flags, stages are a quality

The rule of thumb that settles most cases:

> A flag records **that something happened**. A quality records **how far along a story
> is**.

The two live together happily. An interrogation can run on an `investigation` quality
for its spine while a `rel_anna` flags property records what the character learned along
the way, and a plain boolean records which ending you took.

Two warnings, both from using this at scale:

**Do not build one big quality.** A project wants many small ladders, one per arc, not a
single `game_progress` with forty stages. The moment two things can be true at once, or
two threads advance independently, one ladder starts lying about your story.

**Not everything that looks sequential is.** A scene can read like a spine until you
notice the player can reach its middle two ways, without the beat that appears to come
first. The test is not whether the beats have a natural order in your head; it is whether
play can only ever visit them in that order. If it cannot, they are facts, and facts are
flags.

## Choosing, in one pass

1. Is it just true or false? **boolean**.
2. Do you do arithmetic on it, or show the number to the player? **number**.
3. Is it text you did not choose in advance? **string**.
4. Can several be true at once? **flags**.
5. Is it one of a fixed set, where "or past it" is meaningless? **enum**.
6. Is it one of a fixed set that only moves forwards, where "or past it" is exactly what
   you want to ask? **quality**.

Patterpad's Properties tab offers all six, and the compiler checks whatever you pick:
unknown stage names, unknown enum values and unknown flag names are all errors before you
run the project. What it cannot catch statically, such as a stage nothing ever advances
to, comes back from [Coverage testing](/production/coverage-testing/).

## Declaring a quality in Patterpad

In **Settings ▸ Properties** (or **World Properties**, for a value your game owns), pick
**Stages** as the type and add the stages in order. Each stage chip carries ‹ › movers,
because for a ladder the order is the meaning: reordering the chips reorders the story.
A quality's default is its first stage unless you pick another.

From there the condition editor treats it as what it is: the property appears in the
clause picker, the operator step offers the ordering comparisons as well as the equality
pair, and the value step lists your stages in ladder order. An effect that targets a
quality starts as `advance(...)`, which is the answer you want most of the time; click
the pill if you meant a specific stage.
