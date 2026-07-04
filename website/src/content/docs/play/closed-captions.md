---
title: Closed captions
description: Let players turn off the non-spoken caption cues inside dialogue, Patterplay strips them at runtime, on every engine, while the line still fires so audio plays.
sidebar:
  label: Closed captions
---

A lot of dialogue carries **non-spoken cues**: `"Oh dear. [sigh] What now?"`, `"[whispering] Over here."`,
a line that is *only* a sound effect. With closed captions **on** (the default) the player sees all of it.
A player who can hear the audio may want them **off**, and Patterplay then removes those cues at runtime,
identically on every engine.

This is a pure text feature: it doesn't depend on the audio system, voiced mode, or anything else.

<svg viewBox="0 0 760 196" role="img" aria-labelledby="pk-cc-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-cc-title">With captions off, the runtime removes each bracketed cue from a line. A line that is only a cue becomes a silent line: no text, but its event still fires so its audio still plays.</title>
  <defs><marker id="pk-cc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker></defs>
  <text x="184" y="26" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">Captions on</text>
  <text x="576" y="26" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">Captions off</text>
  <!-- row 1: dialogue with a cue -->
  <rect x="24" y="38" width="320" height="42" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <text x="40" y="64" font-size="13"><tspan fill="var(--pt-teal-ink,#214f4b)" font-weight="600">ANNA  </tspan><tspan fill="var(--sl-color-white)">Oh dear. </tspan><tspan fill="var(--pt-gold,#cf9433)">[sigh]</tspan><tspan fill="var(--sl-color-white)"> What now?</tspan></text>
  <path d="M348 59 H412" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-cc-arrow)"/>
  <rect x="416" y="38" width="320" height="42" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <text x="432" y="64" font-size="13"><tspan fill="var(--pt-teal-ink,#214f4b)" font-weight="600">ANNA  </tspan><tspan fill="var(--sl-color-white)">Oh dear. What now?</tspan></text>
  <!-- row 2: an all-cue SFX line -->
  <rect x="24" y="92" width="320" height="42" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <text x="40" y="118" font-size="13"><tspan fill="var(--pt-ember,#d2603e)" font-weight="600">SFX  </tspan><tspan fill="var(--sl-color-white)">Thunder rumbles.</tspan></text>
  <path d="M348 113 H412" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-cc-arrow)"/>
  <rect x="416" y="92" width="320" height="42" rx="8" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)" stroke-dasharray="4 4"/>
  <text x="432" y="118" font-size="12.5" font-style="italic" fill="var(--sl-color-gray-3)">silent line, audio still plays</text>
  <text x="380" y="162" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">Each cue is stripped and the spacing closed up.</text>
  <text x="380" y="180" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">A cue-only line goes silent, but its audio still plays.</text>
</svg>

:::tip[Writers: you only need the first half]
Writing the cues is your job (the **Authoring** section next). Wiring the on/off toggle into the
game is your developer's, from *Turning them off in your game* onward. You can stop reading there.
:::

## Authoring (in Patterpad)

Write the cues inline in your dialogue, wrapped in the project's caption delimiters: `[` and `]` by
default:

> ANNA.  Oh dear. *[sigh]* What now?

Square brackets are the default because they match the closed-captioning convention for non-speech cues,
and because parentheses are already spoken for: a `(` at the **start** of a line opens a performance
[direction](/patterpad/writing-surface/) in the editor, so it can't also start a caption there.

Configure it in **Project Settings ▸ Closed Captions**:

- **Open / Close**: the delimiter pair that wraps a cue. Default `[` and `]`; you can use any pair, even
  the same token both sides (e.g. `*…*`). Avoid `(`: it opens a direction at the start of a line.
- **Caption character**: a cast member (default **`SFX`**) whose **whole lines** are treated as pure
  captions. A line spoken by this character is removed *entirely* when captions are off: delimiters or not
 , so you can write sound-only lines like `SFX: Thunder rumbles in the distance.`

Defaults apply even if you never open the tab: `[` / `]` and an `SFX` character.

## What the runtime does when captions are off

For each **dialogue line** (it never touches narration, choice text, or anything else):

1. If the line is spoken by the **caption character**, the whole line is removed.
2. Otherwise every `open…close` cue is removed, and the surrounding whitespace is collapsed:
   `"Oh dear. [sigh] What now?"` → `"Oh dear. What now?"`.

If that leaves the line **empty** (the whole line was a cue), it becomes a **silent line**: the dialogue
event *still fires* (so its **audio still plays** and visit-tracking still counts) but it carries **no
text and no speaker**, so nothing is captioned. Lines with no cue are returned untouched.

Captions are a **presentation** setting, like the language: toggling them never changes save state, the
story position, or which lines play. Audio is keyed off the line's id, so a silent line's voice take plays
exactly as before.

## Turning them off in your game

*The rest of this page is for your developer.* Captions default to **on**. Flip them at construction
or live, on any runtime:

```js
// JavaScript / TypeScript (@patterkit/runtime or patterplay.min.js)
const engine = new Patterplay.Engine(bundle, { closedCaptions: false }); // start off
engine.setClosedCaptions(true);   // or toggle live, e.g. from a settings menu
engine.closedCaptions;            // current state
```

| | Construct off | Toggle live | Read |
| --- | --- | --- | --- |
| **JavaScript** | `new Engine(b, { closedCaptions: false })` | `engine.setClosedCaptions(on)` | `engine.closedCaptions` |
| **Unity (C#)** | `new Engine(b, new EngineOptions { ClosedCaptions = false })` | `engine.SetClosedCaptions(on)` | `engine.ClosedCaptions` |
| **Unreal (C++)** | `EngineOptions{ closedCaptions=false }` | `engine.setClosedCaptions(on)` | `engine.closedCaptions()` |
| **Godot (GDScript)** | `PatterEngine.new(b, { "closed_captions": false })` | `engine.set_closed_captions(on)` | `engine.closed_captions()` |

Already-emitted lines aren't retro-edited (that's the host's call); the change applies to the next line.

### IDs-only builds

In an [IDs-only build](/play/localisation/) the runtime emits beat ids and your game looks the text up
itself, so it also applies the caption rule itself. Each flow exposes the same transform the embedded
runtime uses: call it (after `interpolate`) when your captions are off:

```js
let text = myLookup(step.id);
text = flow.interpolate(text);
if (!captionsOn) text = flow.stripCaptions(text); // remove cues with the project's delimiters
```

This stripping is covered by the cross-runtime [test suite](/compatibility/), so every engine strips identically.
