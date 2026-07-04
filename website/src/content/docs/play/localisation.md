---
title: Localisation at runtime
description: "How a Patter bundle carries translatable text into your game: Embedded (the runtime resolves and live-switches languages) vs IDs-only (your loc system supplies the strings), with the same API across all four runtimes."
sidebar:
  label: Localisation
---

How translated text reaches the player is a **build choice** with two modes. The mode is baked
into the bundle, so your integration code constructs the engine the same way either way - what
changes is what a step hands you. (The translation *workflow* - exporting for translators,
importing back, staleness - is the project team's side:
[Localisation](/production/localisation/).)

## The two modes at a glance

| | **Embedded** (default) | **IDs-only** |
|---|---|---|
| What the `.patterc` carries | every locale's strings, inline | **no** strings |
| What the runtime returns for a line | the resolved **text** for the active locale | the line's **ID** |
| Character display name | resolved (localised) | **omitted**, you get the `character` token |
| `{@property}` interpolation | done by the runtime | you call `flow.interpolate(text)` yourself |
| Switch language at runtime | `engine.setLocale("fr")`, live | your loc system's job |
| Who owns translations | the bundle | **your game's** localisation system |
| Best for | self-contained games, quick ship, the runtime does it all | games with an existing loc pipeline (Unity Localization, i18n, a CMS, …) |

## Embedded: the runtime does it

```js
import { Engine } from "@patterkit/runtime";
const engine = new Engine(bundle, { locale: "fr" });   // or omit: the bundle's default
const flow = engine.openFlow("main", { scene: "intro" });
const step = flow.advance();   // step.text is resolved, interpolated French; characterName localised
```

Switch language live without losing the player's place:

```js
engine.setLocale("fr");   // subsequent beats render in French; flow state is untouched
```

A string missing in the active locale falls back to the source text flagged
`<Untranslated: {id}> …`, so a half-finished translation is impossible to miss.

## IDs-only: your game does it

`step.text` is the **beat ID** and `step.characterName` is **omitted** (you still get
`step.character`, the stable token). Look the text up yourself, then apply `{@property}`
replacement with the flow:

```js
const step = flow.advance();             // step.text === "L_greet" (an ID), step.character === "GUIDE"
const raw = myLocaliser.lookup(step.text, currentLanguage);   // e.g. "Bonjour {@name}"
const shown = flow.interpolate(raw);     // -> "Bonjour Alice"  (your game's job to call)
const speaker = myLocaliser.lookup("cast:" + step.character, currentLanguage); // localise the name too
```

The ID → source tables your loc system needs come from the same export the translators use
(JSON is the natural format here) - see
[the workflow page](/production/localisation/#the-formats).

If the build was made with `--source-debug`, the engine resolves the embedded **source**
strings (so the build is playable before your loc system exists) and exposes
`engine.isSourceDebug === true` plus a one-time console warning: never ship that build.

## Everywhere the same

All four runtimes handle both modes identically - JavaScript (`@patterkit/runtime`), Unity
(C#), Unreal (C++), and Godot (GDScript) - each held to the same
[shared test suite](/compatibility/). `setLocale` is live on every one of them.
