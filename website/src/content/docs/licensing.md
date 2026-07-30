---
title: Use it, ship it, and if you like? Say so.
description: "Patter is free and MIT-licensed, with no obligation to credit anyone. This page covers the part that is a favour - credit lines and made-with badges you can download - plus what you may do with the Patter name and mark, and the third-party components bundled with the tools."
sidebar:
  label: Licensing & credit
---

Patter and its tools are free and MIT-licensed. Ship a commercial game with it, fork it, modify
it, keep your changes private: no fee, no registration, no royalty, and no obligation to credit
anyone.

This page covers the part that is a favour (a credit line or a badge), what you can do with the
Patter name and mark, and info on licenses for the third-party components bundled with the tools.

## Why a credit helps

> It's entirely voluntary but really useful. Every project who hears about and starts
> using Patter is another set of real-world edge cases: bugs I would never have hit myself,
> workflows I hadn't imagined, pressure that pushes the toolset to get better for everyone using it.
>
> And selfishly, it's a warm feeling to know one more team didn't have to go through the
> dialogue-writing-pipeline pain that made me build this in the first place.
>
> <cite>Ian Thomas, PatterKit</cite>

## A line of text is plenty

If a graphic doesn't work for you, copy one of these instead. No approval needed.

For in-game credits or a readme:

```text
Dialogue made with Patter - patterkit.dev
```

As a credits block:

```text
NARRATIVE TOOLS
Dialogue authored and played with Patter
patterkit.dev
```

For a website or itch.io footer:

```html
<a href="https://patterkit.dev">Dialogue made with Patter</a>
```

## Or use the badge

Scale them freely. Please don't recolour or redraw them.

**The badge** (360 × 112) suits credits screens, splash pages, and press kits:

<div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;margin:1rem 0;">
  <figure style="margin:0;">
    <img src="/badges/patter-badge-paper.svg" width="360" height="112" alt="Dialogue made with Patter badge, warm paper colour way" style="display:block;border-radius:8px;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/patter-badge-paper.svg">SVG</a> · <a href="/badges/patter-badge-paper.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/patter-badge-stage.svg" width="360" height="112" alt="Dialogue made with Patter badge, dark stage colour way" style="display:block;border-radius:8px;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/patter-badge-stage.svg">SVG</a> · <a href="/badges/patter-badge-stage.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/patter-badge-mono.svg" width="360" height="112" alt="Dialogue made with Patter badge, one-colour" style="display:block;border-radius:8px;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/patter-badge-mono.svg">SVG</a> · <a href="/badges/patter-badge-mono.png">PNG</a></figcaption>
  </figure>
</div>

**The line** (one line) suits footers, itch.io pages, and readmes:

<div style="display:flex;flex-direction:column;gap:0.8rem;align-items:flex-start;margin:1rem 0;">
  <figure style="margin:0;">
    <img src="/badges/patter-line-paper.svg" width="330" height="38" alt="Dialogue made with Patter line badge, warm paper colour way" style="display:block;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/patter-line-paper.svg">SVG</a> · <a href="/badges/patter-line-paper.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/patter-line-stage.svg" width="330" height="38" alt="Dialogue made with Patter line badge, dark stage colour way" style="display:block;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/patter-line-stage.svg">SVG</a> · <a href="/badges/patter-line-stage.png">PNG</a></figcaption>
  </figure>
  <figure style="margin:0;">
    <img src="/badges/patter-line-mono.svg" width="330" height="38" alt="Dialogue made with Patter line badge, one-colour" style="display:block;" />
    <figcaption style="font-size:0.8rem;margin-top:0.3rem;"><a href="/badges/patter-line-mono.svg">SVG</a> · <a href="/badges/patter-line-mono.png">PNG</a></figcaption>
  </figure>
</div>

Or take the whole set: both shapes, all three colour ways, SVG and 2x PNG, plus this page's
credit lines as a text file. **[Download the badge kit (zip)](/badges/patter-made-with-badges.zip)**

## The name and the mark

The MIT licence covers the code in the Patter repo. The Patter and PatterKit names, the drop mark and these badges
aren't covered by it, so here's the plain-English version.

### Yes, please do

- Say your game's dialogue was made with Patter, in credits, marketing, a blog, or a talk.
- Use these badges unmodified, at any size, in game, on your site, or in a press kit.
- Name Patter in a list of tools and middleware alongside your engine.
- Use the wordmark in an article, tutorial or video about Patter.

### Please don't

- Recolour, redraw, stretch or rebuild the mark, or set the wordmark in another typeface.
- Use the mark as your own product, studio, or app icon.
- Imply that PatterKit endorses, sponsors, or has reviewed your project.
- Put Patter or PatterKit in your product name, company name or domain.
- Sell the badges, or the tools, as a product of your own.

Something not covered here, or a use you're not sure about? Ask, and the answer will probably be yes:
[open a discussion on GitHub](https://github.com/patterkit/patter/discussions).

## Third-party licences

Patter and its tools are MIT-licensed. They also bundle a few third-party components that keep
their own licences; the notable ones are collected here.

### Json.NET (Unity runtime)

The Patterplay Unity package depends on Unity's `com.unity.nuget.newtonsoft-json` package
([Json.NET](https://www.newtonsoft.com/json), MIT, © James Newton-King) for bundle and save
parsing. Unity's Package Manager delivers it; it is not bundled inside the Patterplay download.

### Spell-check dictionaries and engine

The built-in English dictionaries come from [SCOWL / the English Speller
Database](https://wordlist.aspell.net/), under a permissive BSD/MIT-style licence (attribution
only). The spell-checking engine is [`nspell`](https://github.com/wooorm/nspell) (MIT). Any
Hunspell dictionaries you import yourself keep their own licences; that is between you and
wherever you got them. See [Spell-check](/spell-check/) for how these are used.

---

MIT-licensed - made by Ian Thomas
[Read the MIT licence](https://github.com/patterkit/patter/blob/main/LICENSE)
