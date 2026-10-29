# PatterKit brand assets

This folder is the source for every shipped PatterKit icon, mark and wordmark. Patterpad's app and document
icons, the website's favicons and the plugin icons are all built from it, so a change made here is made
everywhere. Storylet Studio is the sibling brand, built the same way (`storylets/branding/README.md`).

## The mark

One **drop**, on a 100×100 grid:

    M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z

The PatterKit mark is two drops, one pointing left and one pointing right, like two lines of dialogue:
teal above, ember below (`marks/patterkit.svg`). It's always the drop, transformed, and never redrawn.

## Products

Each product has its own glyph, cut from the drop, in cream on its own ground:

| Product | Ground | Glyph |
| --- | --- | --- |
| PatterKit (umbrella) | parchment `#F1EBE0` | the two-drop mark, in teal and ember |
| Patter (the language) | teal `#214F4B` | the drop |
| Patterpad (authoring) | teal `#214F4B` | a drop pointing left, with three lines of text |
| Patterplay (runtimes) | ember `#D2603E` | a drop pointing right, with a play arrow |

The plugin icons badge the four engines for Patterplay, and the document icons cover `.patter`, `.patterc`,
`.patterproj` and `.patterpack`.

## Palette

| | hex | use |
| --- | --- | --- |
| Teal | `#214F4B` | primary: the upper drop, "Kit" in the wordmark, Patter and Patterpad grounds |
| Ember | `#D2603E` | accent: the lower drop, the Patterplay ground |
| Ink | `#312B22` | wordmark text |
| Cream | `#FBF7F0` | glyphs on teal and ember |
| Parchment | `#F1EBE0` | the PatterKit icon's ground |

**On a dark ground** the teal lightens to `#6FA39C` and ember stays `#D2603E`; the wordmark's text becomes
cream. That's the only dark-ground teal: `patterkit-wordmark-dark.svg` on the docs site and Patterpad's
About box in its dark themes both use it. The document icons use darker and lighter teals for depth, and
those stay inside the icons.

The brand colours are for the brand: the marks, the wordmarks, and the icons. The website and the apps take
their interface colours from the family palette in app-shell (blue pencil for links and actions), and never
draw the mark in the interface accent.

## Wordmarks

The mark, then the name in Newsreader 500 at 120 px, `letter-spacing: -2`, on an 820×220 canvas: the
mark at `translate(40,30) scale(0.98)`, text from `x=232`, baseline `y=150`. The name is ink; in
"PatterKit", "Kit" is teal.

The wordmarks here are still live `<text>`, so they render in Newsreader only where it's installed or
loaded (the website and the apps load it). Storylet Studio's are converted to curves, and these should be
too before they're offered as downloads.

## Where they're used

- **Patterpad:** `icons/png/icon-patterpad-1024.png` is the app icon (`packages/patterpad/package.json`). The
  document icons are padded to squares by `packages/patterpad/scripts/build-doc-squares.py` into
  `document-icons/square/`, then bundled as `.icns` and `.ico` in `packages/patterpad/build/`.
- **The website:** the favicon is the PatterKit icon; the docs header uses the PatterKit wordmark (light and
  dark); the landing header and footer draw the mark from the shared site chrome.
- **GitHub:** the organisation's avatar is `icons/png/icon-patterkit-1024.png`.

## Contents

    marks/            the drop, the two-drop PatterKit mark, and each product's glyph
    icons/svg         four product icons
    icons/png         1024 PNG of each
    document-icons/   .patter, .patterc, .patterproj, .patterpack: svg, 1024 png, and 1024 square png
    plugin-icons/     Patterplay badges: Godot, Unreal, Unity, JavaScript, svg and 1024 png
    wordmarks/        PatterKit, Patter, Patterpad, Patterplay
