---
title: Scenes, blocks and beats
description: Learn the Patter narrative tree, from scenes down to beats, and how jumps route between them.
sidebar:
  label: Scenes, blocks and beats
---

Patter's structure is a tree of **Scene → Block → Group → Snippet → Beat**. One rule
runs through all of it: *a container picks among its children, and each child decides
whether it's eligible.* So the things you can **select** (groups, snippets) can carry
a condition; the things you **address** (scenes, blocks) cannot.

There's a second idea worth holding onto, which is that the tree works at **two levels**.

Selection is the walk down the tree that decides the next beat. Delivery is what your game
sees, a flat stream of beats, pulled one at a time until a choice or the end. The host never
sees a snippet or a block; it just pulls beats.

<svg viewBox="0 0 760 244" role="img" aria-labelledby="pk-struct-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-struct-title">Two altitudes: the selection tree (Scene, Block, Group, Snippet, Beat, where groups and snippets can carry conditions) flattens into a delivery stream of individual beats that the host pulls one at a time.</title>
  <defs><marker id="pk-s-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker></defs>
  <text x="150" y="24" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">Selection: the tree</text>
  <g font-size="12.5" fill="var(--sl-color-white)">
    <rect x="24" y="36" width="176" height="26" rx="4" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="36" y="54">Scene</text><text x="192" y="54" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">address</text>
    <rect x="44" y="66" width="176" height="26" rx="4" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="56" y="84">Block</text><text x="212" y="84" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">address</text>
    <rect x="64" y="96" width="176" height="26" rx="4" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="76" y="114">Group</text><text x="232" y="114" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">selectable</text>
    <rect x="84" y="126" width="176" height="26" rx="4" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="96" y="144">Snippet</text><text x="252" y="144" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">selectable</text>
    <rect x="104" y="156" width="176" height="26" rx="4" fill="color-mix(in oklab, var(--sl-color-accent) 8%, var(--sl-color-bg-sidebar))" stroke="var(--sl-color-accent)"/><text x="116" y="174">Beat</text><text x="272" y="174" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">delivered</text>
  </g>
  <text x="410" y="102" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">flatten</text>
  <path d="M362 112 H468" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-s-arrow)"/>
  <text x="600" y="22" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">Delivery: beats you pull</text>
  <text x="600" y="38" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">one at a time, in order</text>
  <g font-size="12" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)">
    <rect x="500" y="48" width="200" height="26" rx="4" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="66">line</text>
    <rect x="500" y="78" width="200" height="26" rx="4" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="96">line</text>
    <rect x="500" y="108" width="200" height="26" rx="4" fill="color-mix(in oklab, var(--sl-color-accent) 8%, var(--sl-color-bg))" stroke="var(--sl-color-accent)"/><text x="600" y="126">choice</text>
    <rect x="500" y="138" width="200" height="26" rx="4" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="156">line</text>
    <rect x="500" y="168" width="200" height="26" rx="4" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="186">end</text>
  </g>
  <text x="380" y="228" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">Groups and snippets can carry a condition; scenes and blocks are just addresses. The host never sees a container, only the beat stream.</text>
</svg>

## The containers

A scene is the unit of context. It owns the cast, scene-local properties, and a list of
effects that run on entry. It holds one or more blocks, and the **first block is where you
enter** (there's no explicit pointer). The sharpest line between a scene and a block is that
scenes run effects when you enter them and blocks don't.

A block is a named, addressable section. A block always **runs** its children in order, so
it's never a "pick one" and never conditional. It must have an author **name**, which
doubles as its jump-target label. To pick one of several things inside a block, nest a
group.

A group is a container with a condition and an optional **selector** (see
[Choices & logic](/format/choices-and-logic/)). Groups nest as deep as you like, so one
group's condition can turn a whole subtree on or off.

A snippet is the only leaf, and the smallest playable unit, zero or more beats played as
one, optionally followed by a jump. Nothing is re-evaluated *inside* a snippet. The seam
*between* snippets is the only place interaction can happen.

## Beats

A snippet holds **beats**, and there are three kinds.

A `line` beat is spoken dialogue. It has a `character` (checked against the cast), an
optional `direction` for the performer (language-neutral, never localised), an optional
**speaker qualifier**, and localised text. A voiced line is a fixed string, with no
interpolation.

A speaker qualifier is what a screenplay calls a character extension: `TAM (O.S.)` for a
character heard but not seen, `PLAYER (V.O.)` for a thought, `GUARD (RADIO)` for a voice over a
radio. It says how the line is delivered, not who says it, so `TAM` and `TAM (O.S.)` are the same
character everywhere. The line stores the qualifier's `gameId` (`os`), picked from the project's
list of [qualifiers](/setup/cast/#speaker-qualifiers).

A `text` beat is prose with no speaker: a description, the author's voice, or a page the player
reads. It's never voiced, and is free to interpolate property values. (Narration, in Patter, is a
spoken line whose character is a narrator, such as `NARRATOR`.)

What a text beat is for depends on its scene. A **dialogue scene** has at least one `line` beat that
names a character (an option's spoken prompt counts); any other scene is a **text scene**. In a text
scene, text is shown to the player and localised. In a dialogue scene, text is **action** by default,
as in a screenplay: a direction for whoever stages the scene (`MARA turns away.`), never shown to the
player and never localised. The bundle marks each action beat with `action: true` and carries its
source text in every locale. Turn on the project setting `localiseDialogueText` in the `.patterproj`
(off when absent) and a dialogue scene's text is localised and shown like a text scene's instead. An
option's prompt is never action. See
[What gets translated](/production/localisation/#what-gets-translated).

A game event is an instruction to the engine with **no visible words**. It carries only Game
Data the host reads when the beat plays, so it can play a sound or move a camera. Game event
beats never appear in the locale tables.

A line or text beat can also carry **`padAfter`**, the pause after it in seconds, from -10 to 60. A
positive pause waits, zero follows at once, and a negative one starts the next beat that long before
this one ends, so the next line cuts in on it. A beat that sets none takes the nearest
**`padAfterDefault`** above it (its snippet, any groups around it, its block, its scene), then the
project's, then 0.6 seconds. A snippet's last line can't be cut in on, because what follows it isn't
certain until the story chooses, so a negative pause there plays as none.

An option's [prompt](/format/choices-and-logic/#choices-and-options) carries `padAfter` too. When the
prompt is spoken, its pause times the reply. A line prompt can carry a speaker qualifier, as any line
can.

Every beat gets a stable **id** the moment it's created, never based on its content or
position. Translations, jumps, cursors, and visit counts all key off that id, so
content can move around freely without breaking anything.

## Jumps

A snippet can end with a **jump**, which fires at the snippet's closing seam, after
its beats. A snippet that is *only* a jump (no beats) is a pure routing node. Jumps
target a **scene**, a **block**, or the reserved **`END`**, never a snippet (a snippet
plays as a whole, so you can't land partway into one).

There are two kinds.

A `jump` is the default, and it's one-way. It heads where it says and **drops any pending
returns**.

A `call` heads there and *comes back*. It remembers where it was, runs the target, and
returns to the next child in the calling block when the target finishes (Ink calls this a
"tunnel"). Calls nest and recurse safely.

A jump can carry a **condition**: "jump if X, otherwise carry on." When a snippet just
falls off the end of its block, the dialogue is finished: the same signal as an
explicit `→ END` (a `call` returns to its caller first).

Anything after a snippet that always jumps never plays. When a snippet with no condition
jumps (to `END` or anywhere else, beats or not), whatever follows it in the same run gets an
`unreachable-after-jump` warning from the validator. A `call` comes back, so it doesn't count,
and nor does a jump with a condition, or one inside an option or another selector's child:
those might not be taken, so what follows the choice or group still runs.

## Choices and selectors

Branching past a simple run (the `branch`, `sequence`, and `choice` selectors,
options, and their flags) is covered on the next page,
[Choices & logic](/format/choices-and-logic/).
