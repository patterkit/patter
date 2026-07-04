---
title: Structure & branching
description: Choices, selectors, jumps, and the action menu that shapes a Patter scene in Patterpad.
sidebar:
  label: Structure & branching
---

Branching in Patter comes from a handful of building blocks, and Patterpad shapes them
without ever asking you to wire up a flow chart. You change the structure through the
**action menu**; the *details* on each piece live in the
[inspector](/patterpad/conditions-and-data/).

## The action menu (⋯ / right-click)

Every snippet and group has a quiet **⋯** button at its top-right, and
**right-clicking** anywhere on it opens the same menu. It holds the structural moves:

- **Follow with ▸**: add something after this piece, a Snippet, a Branch, a Choice, or
  a Sequence in one of its three ready-made shapes (**Once each**, **Cycle**, or
  **Shuffle**).
- **Wrap in ▸**: wrap this piece (or several you've selected) in a Branch, a Choice, or
  a Sequence (**Once each**, **Cycle**, or **Shuffle**).
- **Add option**: on a choice (the same as the inline **"+ option"** control).
- **Ungroup**: undo a group, so its contents move up a level.
- **Split here / Join with previous / Join with next**: for snippets, shown only when
  they make sense.
- **Delete**: remove the piece (with a quick confirm unless it's already empty).

All of it is undoable.

## Choices and options

A **choice** offers the player options. Each option holds:

- a **prompt**: the line the player reads, handed to your game exactly as you wrote it;
- optional **content**: anything from a single line to a whole branch of its own,
  played when the option is taken;
- a few per-option **flags** (below).

Edit all of a choice's options together in one inspector panel: prompt, condition, and
flags side by side, with reorder, delete, and add.

<svg viewBox="0 0 760 272" role="img" aria-labelledby="pk-branch-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-branch-title">A choice branches into options, each with its own content, then rejoins at a gather and carries on. Separately: a jump leaves for another scene or block and does not return; a call runs a shared piece of story and then returns to where it left off.</title>
  <defs><marker id="pk-b-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker>
    <marker id="pk-b-arrow-t" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--pt-teal-mid,#2f6f66)"/></marker></defs>
  <text x="300" y="20" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">A choice branches, then rejoins</text>
  <!-- choice -->
  <rect x="24" y="76" width="96" height="40" rx="8" fill="color-mix(in oklab, var(--pt-ember,#d2603e) 12%, var(--sl-color-bg-sidebar))" stroke="var(--pt-ember,#d2603e)"/>
  <text x="72" y="100" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Choice</text>
  <!-- options -->
  <g font-size="12" fill="var(--sl-color-white)">
    <rect x="210" y="44" width="180" height="28" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="224" y="63">option A content</text>
    <rect x="210" y="82" width="180" height="28" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="224" y="101">option B content</text>
    <rect x="210" y="120" width="180" height="28" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="224" y="139">option C content</text>
  </g>
  <!-- choice -> options (all fan from one point), options -> gather (all converge to one point) -->
  <g stroke="var(--sl-color-gray-3)" fill="none">
    <path d="M120 96 H166 V58 H210" marker-end="url(#pk-b-arrow)"/>
    <path d="M120 96 H210" marker-end="url(#pk-b-arrow)"/>
    <path d="M120 96 H166 V134 H210" marker-end="url(#pk-b-arrow)"/>
    <path d="M390 58 H426 V96 H470" marker-end="url(#pk-b-arrow)"/>
    <path d="M390 96 H470" marker-end="url(#pk-b-arrow)"/>
    <path d="M390 134 H426 V96 H470" marker-end="url(#pk-b-arrow)"/>
  </g>
  <!-- gather -->
  <rect x="470" y="76" width="112" height="40" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--pt-teal-ink,#214f4b)"/>
  <text x="526" y="93" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Gather</text>
  <text x="526" y="108" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">rejoin here</text>
  <path d="M582 96 H616" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-b-arrow)"/>
  <text x="624" y="100" fill="var(--sl-color-gray-3)" font-size="11">carry on</text>
  <!-- divider -->
  <line x1="24" y1="164" x2="736" y2="164" stroke="var(--sl-color-gray-5)"/>
  <text x="24" y="184" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">Two ways a snippet diverts</text>
  <!-- jump row -->
  <rect x="24" y="196" width="94" height="30" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="71" y="215" text-anchor="middle" fill="var(--sl-color-white)" font-size="12.5">↪ jump</text>
  <path d="M118 211 H154" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-b-arrow)"/>
  <text x="162" y="215" fill="var(--sl-color-gray-3)" font-size="11.5">leaves for another scene or block, and never comes back</text>
  <!-- call row -->
  <rect x="24" y="234" width="94" height="30" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/><text x="71" y="253" text-anchor="middle" fill="var(--sl-color-white)" font-size="12.5">⤳ call</text>
  <path d="M118 245 H154" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-b-arrow)"/>
  <path d="M154 257 H118" stroke="var(--pt-teal-mid,#2f6f66)" fill="none" marker-end="url(#pk-b-arrow-t)"/>
  <text x="162" y="253" fill="var(--sl-color-gray-3)" font-size="11.5">runs a shared piece of story, then returns to carry on here</text>
</svg>

### Option flags

| Flag | Meaning |
| --- | --- |
| **Sticky** | Repeatable. Left off (the default), an option is **once-only**: once the player takes it, it's gone from the choice. |
| **Fallback** | Taken automatically the moment it's the last option standing. One per choice at most, and its prompt is never shown. |
| **Secret** | Completely hidden from your game while its condition is unmet, so it can't leak through the choice or a saved game. |

An option is available only when its **condition** is met. Options carry conditions just
like snippets do (a required item, a story flag, a visit count), and that condition is
what decides whether the player can take it. By default an option whose condition fails is
**still shown, not removed**: your game receives it flagged as unavailable, along with the
reason, and decides how to present it (dimmed, locked, struck through, or hidden, that
part is up to your UI). It lets you show "the path you couldn't take." Reach for
**Secret** only when an option must stay invisible until it's unlocked.

:::caution[A choice can run dry]
If a choice ends up with nothing the player can take and no fallback, it steps past itself and the
story carries on, rather than dead-ending the game at runtime. That runtime softness is deliberate (a
shipped game should never hard-lock on a choice), but a silent fall-through is usually an accident, so
the editor does not let it hide:

- Patterpad **warns** when a choice has no fallback and no unconditional option, since it can run dry if
  every condition happens to fail.
- A **Coverage Test** (Review ▸ Run Coverage Test) **flags any choice it actually saw run dry**, with a
  click-through to the offending choice.

Give such a choice a fallback option, or one unconditional option, to guarantee the player a way through.
:::

## Selectors: how a group picks

Any group has a **selector** (set in the inspector) that decides which of the things
inside it play:

- **Run** (the default): play everything eligible, in order.
- **Branch**: play only the first eligible item. This is your if / else-if / else,
  just conditions on an ordered list.
- **Sequence**: a picker with a memory and two dials:
  - **Order**: *In order* or *Shuffle* (shuffle never repeats a line right after
    itself, and works through them all before reshuffling);
  - **Exhaust**: *Play once*, *Repeat*, or *Stick on last*.
- **Choice**: offer everything inside as options and wait for the player.

Those two Sequence dials cover the everyday patterns: "say each line once", "cycle
forever", "random with no instant repeat", "stop on the last line". You can also
**share** a Sequence's memory (an inspector toggle) so two characters never draw the
same shuffled line.

The action menu's **Once each**, **Cycle**, and **Shuffle** aren't separate things.
They're all the same Sequence, pre-set for the three most common setups:

| Preset | Order | Exhaust |
| --- | --- | --- |
| **Once each** | In order | Play once |
| **Cycle** | In order | Repeat |
| **Shuffle** | Shuffle | Repeat |

Drop one in, then nudge the **Order** and **Exhaust** dials in the inspector to reach
any combination you like. The preset is just a starting point.

## Jumps and diverts

A snippet can end with a **jump** to a scene, a block, or `END`. Open the jump row in
the inspector and type to find any scene or block in the project (plus END). Once it's
set, a small **jump / call** toggle sits beside it, so you choose how it behaves:

- **↪ jump**: head there and don't come back (the default);
- **⤳ call**: head there, and when it finishes, come back and carry on where you left
  off. Handy for a bit of story you want to reuse from several places (a shared aside, a
  recurring bit of business), without copying it.

The chip on the page shows the mode too, so you can tell a one-way `↪` from a returning
`⤳` at a glance. Renaming a scene or block never breaks a jump that points at it. A
snippet that's *just* a jump, with no lines of its own, is a neat way to route the story
around. (`⌘/Ctrl-click` a jump chip to follow it to its target.)

## Conditions in the script

Wherever a snippet or group has a condition, the script shows it as a quiet `if …`
tag, and you edit it visually in the inspector. See
[Conditions, effects & data](/patterpad/conditions-and-data/).

## The inspector, briefly

The right pane (`⌘2`) stacks up everything around your cursor, innermost first: the
**line, text, or game event**, its **snippet**, any **groups** around it, and the
**block** and **scene**. Click a level's header to jump to it. The title bar shows the
`<scene>.<block>` address (click to copy), and a line shows its `#id` (also copyable,
so you can hand it to a developer for translation or audio). The full tour of the
inspector's editors is on the [next page](/patterpad/conditions-and-data/).
