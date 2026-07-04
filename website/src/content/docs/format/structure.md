---
title: Scenes, blocks & beats
description: The Patter narrative tree (scenes, blocks, groups, snippets, beats) and how jumps route between them.
sidebar:
  label: Scenes, blocks & beats
---

Patter's structure is a tree: **Scene → Block → Group → Snippet → Beat**. One rule
runs through all of it: *a container picks among its children, and each child decides
whether it's eligible.* So the things you can **select** (groups, snippets) can carry
a condition; the things you **address** (scenes, blocks) cannot.

There's a second idea worth holding onto: the tree works at **two levels**.

- **Selection** is the walk down the tree that decides the next beat.
- **Delivery** is what your game sees: a flat stream of beats, pulled one at a time
  until a choice or the end. The host never sees a snippet or a block; it just pulls
  beats.

<svg viewBox="0 0 760 244" role="img" aria-labelledby="pk-struct-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-struct-title">Two altitudes: the selection tree (Scene, Block, Group, Snippet, Beat, where groups and snippets can carry conditions) flattens into a delivery stream of individual beats that the host pulls one at a time.</title>
  <defs><marker id="pk-s-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker></defs>
  <text x="150" y="24" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">Selection: the tree</text>
  <g font-size="12.5" fill="var(--sl-color-white)">
    <rect x="24" y="36" width="176" height="26" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="36" y="54">Scene</text><text x="192" y="54" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">address</text>
    <rect x="44" y="66" width="176" height="26" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="56" y="84">Block</text><text x="212" y="84" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">address</text>
    <rect x="64" y="96" width="176" height="26" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--pt-teal-ink,#214f4b)"/><text x="76" y="114">Group</text><text x="232" y="114" text-anchor="end" fill="var(--pt-teal-mid,#2f6f66)" font-size="10">selectable</text>
    <rect x="84" y="126" width="176" height="26" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--pt-teal-ink,#214f4b)"/><text x="96" y="144">Snippet</text><text x="252" y="144" text-anchor="end" fill="var(--pt-teal-mid,#2f6f66)" font-size="10">selectable</text>
    <rect x="104" y="156" width="176" height="26" rx="6" fill="color-mix(in oklab, var(--pt-ember,#d2603e) 12%, var(--sl-color-bg-sidebar))" stroke="var(--pt-ember,#d2603e)"/><text x="116" y="174">Beat</text><text x="272" y="174" text-anchor="end" fill="var(--sl-color-gray-3)" font-size="10">delivered</text>
  </g>
  <text x="410" y="102" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">flatten</text>
  <path d="M362 112 H468" fill="none" stroke="var(--sl-color-gray-3)" marker-end="url(#pk-s-arrow)"/>
  <text x="600" y="22" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">Delivery: beats you pull</text>
  <text x="600" y="38" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">one at a time, in order</text>
  <g font-size="12" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)">
    <rect x="500" y="48" width="200" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="66">line</text>
    <rect x="500" y="78" width="200" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="96">line</text>
    <rect x="500" y="108" width="200" height="26" rx="6" fill="color-mix(in oklab, var(--pt-ember,#d2603e) 10%, var(--sl-color-bg))" stroke="var(--pt-ember,#d2603e)"/><text x="600" y="126">choice</text>
    <rect x="500" y="138" width="200" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="156">line</text>
    <rect x="500" y="168" width="200" height="26" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)"/><text x="600" y="186">end</text>
  </g>
  <text x="380" y="228" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">Groups and snippets can carry a condition; scenes and blocks are just addresses. The host never sees a container, only the beat stream.</text>
</svg>

## The containers

- **Scene**: the unit of context. It owns the cast, scene-local properties, and a
  list of effects that run on entry. It holds one or more blocks, and the **first
  block is where you enter** (there's no explicit pointer). The sharpest line between
  a scene and a block: scenes run effects when you enter them, blocks don't.
- **Block**: a named, addressable section. A block always **runs** its children in
  order; it's never a "pick one" and never conditional. It must have an author
  **name**, which doubles as its jump-target label. To pick one of several things
  inside a block, nest a group.
- **Group**: a container with a condition and an optional **selector** (see
  [Choices & logic](/format/choices-and-logic/)). Groups nest as deep as you
  like, so one group's condition can turn a whole subtree on or off.
- **Snippet**: the only leaf, and the smallest playable unit: zero or more beats
  played as one, optionally followed by a jump. Nothing is re-evaluated *inside* a
  snippet; the seam *between* snippets is the only place interaction can happen.

## Beats

A snippet holds **beats**, and there are three kinds:

- **line**: spoken dialogue. It has a `character` (checked against the cast), an
  optional `direction` for the performer (language-neutral, never localised), and
  localised text. A voiced line is a fixed string, with no interpolation.
- **text**: narration or the author's voice. No speaker, never voiced, and free to
  interpolate property values.
- **game event**: an instruction to the engine with **no visible words**. It carries
  only Game Data the host reads when the beat plays: play a sound, move a camera. Game
  event beats never appear in the locale tables.

Every beat gets a stable **id** the moment it's created, never based on its content or
position. Translations, jumps, cursors, and visit counts all key off that id, so
content can move around freely without breaking anything.

## Jumps

A snippet can end with a **jump**, which fires at the snippet's closing seam, after
its beats. A snippet that is *only* a jump (no beats) is a pure routing node. Jumps
target a **scene**, a **block**, or the reserved **`END`**, never a snippet (a snippet
plays as a whole, so you can't land partway into one).

There are two kinds:

- **jump** (the default): one-way. It heads where it says and **drops any pending
  returns**.
- **call**: head there and *come back*. It remembers where it was, runs the target, and
  returns to the next child in the calling block when the target finishes (Ink calls
  this a "tunnel"). Calls nest and recurse safely.

A jump can carry a **condition**: "jump if X, otherwise carry on." When a snippet just
falls off the end of its block, the dialogue is finished: the same signal as an
explicit `→ END` (a `call` returns to its caller first).

## Choices and selectors

Branching past a simple run (the `branch`, `sequence`, and `choice` selectors,
options, and their flags) is covered on the next page,
[Choices & logic](/format/choices-and-logic/).
