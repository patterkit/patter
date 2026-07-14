---
title: Localisation
description: "Running a Patter project's translation loop: declare your languages, export for translators as JSON, Excel, or PO, import the results back, and let the Status column tell you what needs re-checking when the source changes."
sidebar:
  label: Localisation
---

A Patter project is **ready to translate from the start**: every line, narration, choice
prompt, and character name has a stable **ID** that its translations hang off. Running the
translation side of a project is one small loop, and one rule keeps it sane: **writers only
ever see and edit the source language.** Translations live in their own files, never on the
writing surface - which is also what makes staleness computable (below).

<svg viewBox="0 0 760 168" role="img" aria-labelledby="pk-loc-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="pk-loc-title">The translation round-trip: export source strings as JSON, xlsx, or PO; a translator fills them in; import them back into the locale shards. You only ever edit the source language, and stable line ids mean a moved or edited line never orphans its translation.</title>
  <defs><marker id="pk-l-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker></defs>
  <text x="94" y="30" text-anchor="middle" fill="var(--pt-teal-mid,#2f6f66)" font-size="10.5" letter-spacing="1" style="text-transform:uppercase">You edit here</text>
  <!-- source -->
  <rect x="24" y="42" width="140" height="48" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--pt-teal-ink,#214f4b)"/><rect x="24" y="42" width="140" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="94" y="71" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Source shards</text>
  <text x="185" y="58" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10" style="text-transform:uppercase" letter-spacing="1">export</text>
  <path d="M164 66 H206" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-l-arrow)"/>
  <!-- format pill -->
  <rect x="206" y="50" width="150" height="32" rx="8" fill="color-mix(in oklab, var(--pt-gold,#cf9433) 12%, var(--sl-color-bg-sidebar))" stroke="var(--pt-gold,#cf9433)"/>
  <text x="281" y="70" text-anchor="middle" fill="var(--sl-color-white)" font-family="var(--sl-font-mono,monospace)" font-size="12">JSON · xlsx · PO</text>
  <path d="M356 66 H398" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-l-arrow)"/>
  <!-- translator -->
  <rect x="398" y="42" width="122" height="48" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
  <text x="459" y="71" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Translator</text>
  <text x="540" y="58" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10" style="text-transform:uppercase" letter-spacing="1">import</text>
  <path d="M520 66 H562" stroke="var(--sl-color-gray-3)" fill="none" marker-end="url(#pk-l-arrow)"/>
  <!-- locale shards -->
  <rect x="562" y="42" width="150" height="48" rx="8" fill="var(--sl-color-bg-sidebar)" stroke="var(--pt-teal-ink,#214f4b)"/><rect x="562" y="42" width="150" height="3" rx="1.5" fill="var(--pt-teal-ink,#214f4b)"/>
  <text x="637" y="71" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">Locale shards</text>
  <rect x="24" y="118" width="688" height="34" rx="8" fill="none" stroke="var(--sl-color-gray-5)" stroke-dasharray="4 4"/>
  <text x="368" y="139" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">You only ever edit the source language. Stable line ids mean a moved or edited line never orphans its translation.</text>
</svg>

## Declare your languages

In **Project Settings ▸ Language**, list the languages you'll ship and mark the **default**
(the one writers author in). That's the whole setup.

## The loop: export, translate, import

**Production ▸ Export / Import Localisation…** (also reachable from the Language tab) runs
both halves:

1. **Export** writes the source text - and, for a chosen language, its current translations -
   in the translator's preferred format (below). Hand the file over.
2. The translator fills in the Translation column/fields and sends it back.
3. **Import** reads the language from the file (or you set it) and reports how many
   translations **changed** (re-importing an unedited file reports **0** - unchanged rows
   aren't counted). Translations go into that language's own file; the source is untouched,
   and the writing surface still shows only the source language.

Run the loop as often as you like - it's incremental, not a one-shot. Which brings us to:

### What changed since last time: the Status column

Writers keep writing while translation happens, so the export tracks **staleness** per line.
The Excel export shows it as a **Status** column:

- *(blank)* - not translated yet.
- **translated** - has a translation, and the source line hasn't changed since.
- **stale** - has a translation, but the **source line was edited after it was translated**:
  it needs re-checking against the new wording.

Import writes back **every filled-in translation**, whatever its Status (an empty Translation
cell is left alone). The Status doesn't decide *whether* a row imports - only what happens to its
staleness: an unflagged row is accepted as fresh (its translation is now current for the source as
it stands), while a row still marked **stale** has its text imported but **stays flagged**. The
translator confirms a re-check by *clearing the "stale" cell*, not by re-sending the file - so an
old spreadsheet can never silently bless an outdated translation. (PO files carry the same signal
as the standard `#, fuzzy` flag.)

## The formats

All three carry the same IDs and the same staleness signal; pick by who's receiving the file:

- **Excel (.xlsx)** - for human translators working by hand: one sheet per scene, columns
  ID / Source / Translation / Comments / Status / Gender. The friendliest to non-technical folk.
- **PO / POT** - for agencies and gettext-based tooling (Poedit, Weblate, Crowdin, …).
  Exporting with no language gives a blank **POT** template; staleness is `#, fuzzy`.
- **JSON** - for pipelines and engines: plain ID → string tables, easy to transform or feed
  into your game's own localisation system.

Translator-facing **comments** come from your documentation notes routed to the `loc`
channel - see [Reviewing & feedback](/patterpad/reviewing/).

### Who is speaking: grammatical gender

A gendered language often has to inflect the line itself to match its **speaker** - adjectives,
participles, sometimes the verb. English source text rarely reveals which, so a translator working
line by line is left guessing, and guessing wrong is a bug you only find in a late language pass.

Set a character's **Grammatical gender** in **Project Settings ▸ Cast** and every export carries it
alongside that character's lines:

| Format | Where it appears |
| --- | --- |
| Excel | a **Gender** column |
| PO / POT | an extracted comment, `#. Gender: female` |
| JSON | `context.gender` on the entry |

The field is **free text**, because three genders don't cover every language: it auto-suggests the
everyday values (*male*, *female*, *neuter*) plus any others already used in the cast, so you can name
a common, animate, or inanimate gender while keeping spellings consistent. Whatever you type is passed
to translators verbatim. It rides the character's own dialogue and their display name. Lines with no
speaker (narration) and characters left blank carry nothing, so you only send what you actually know.

Gender is **export-only context**: it is regenerated from the cast on every export, never read back
on import, and never shipped in the compiled `.patterc` bundle. Change a character's gender and the
next export simply tells translators the truth. It describes the character as a grammatical subject
for translation purposes; it is not shipped to, or read by, your game.

## How the strings ship: two approaches

At publish time (**Project Settings ▸ Publish ▸ Localisation**) you pick how the built
bundle carries text:

- **Embedded** (default): every translated language ships **inside** the bundle. The runtime
  resolves the right text and can switch language live, mid-game, with no rebuild. Right for
  self-contained games - nothing else to set up.
- **IDs-only**: the bundle ships **no text at all**; the runtime hands your game each line's
  ID and your game's own localisation system supplies the string. Right when the game
  already has a loc pipeline (Unity Localization, i18n, a CMS…).
  - **Embed source language for debug** (sub-option): adds the source text to an IDs-only
    build *just* so it's playable before your loc system is wired up. It warns it's not for
    release; leave it off for a real build.

Crucially, the choice **doesn't change the translation loop above**: either mode exports and
imports the same files. Going IDs-only never cuts you off from Patter's round-trip - you
still hand translators the same spreadsheets and feed the results into whichever pipeline
ships them.

## Previewing translations

The **Play window** always previews **fully translated**, whatever the build mode: switch
language from its menu and read the script in any locale, even on an IDs-only project. A
string missing in a locale plays as the source text flagged `<Untranslated: …>`, so a
half-finished translation is impossible to miss.

## From the terminal

The same loop, scriptable (see [the CLI](/cli/)):

```sh
patter loc-export -o strings.json --format json          # a blank template (all source, empty translations)
patter loc-export -o fr.xlsx --format xlsx --locale fr   # the fr table as a spreadsheet
patter loc-import fr.xlsx                                 # bring a translated file back
```

`--format` is `json | xlsx | po`; omitting `--locale` produces a blank template / POT. The
build mode is picked per export too: `patter export --ids` / `--source-debug`.

## For the game team

How the two modes look **from inside the game** - `setLocale`, `interpolate`, the
untranslated fallback, all four runtimes - lives with the rest of the integration docs:
[Localisation at runtime](/play/localisation/).
