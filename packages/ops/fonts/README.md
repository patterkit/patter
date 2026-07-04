# Screenplay-PDF fonts

The readable-script **PDF** export embeds these fonts so it renders the design's three type roles as real
faces, and covers accents, arrows, maths, non-Latin scripts, and monochrome emoji without tofu.

The three roles (the reading design):

- **Newsreader** (Regular / SemiBold / Italic / SemiBold-Italic): the reading **serif** - dialogue,
  narration, headings.
- **Inter** (Regular / SemiBold): the UI **sans** - character cues, group / rail labels, option tags.
- **IBM Plex Mono** (Regular): the **mono** - conditions, `{@property}` values, game events.

Those are Latin subsets, so two fallbacks keep full coverage (routed per-character by glyph):

- **DejaVu Sans** (Regular): the marks the layout uses (`◇ ↪ ⚙ ‹ ›`), maths, arrows, and non-Latin scripts
  (Greek, Cyrillic, and so on).
- **Noto Emoji** (monochrome): emoji. PDF can't do colour emoji, so these render black-and-white.

The raw `.ttf` files are **not committed** (see `.gitignore`). They are inlined into `../src/script-fonts.ts`
by `../scripts/gen-fonts-blob.mjs` (gzip + base64, gunzipped lazily). That generated module **is** committed,
so builds and `npm install` need no font files.

## Licences (all open-source compatible)

- **Newsreader**: SIL Open Font License 1.1, (c) Production Type. See `OFL.txt` (shared OFL body).
- **Inter**: SIL Open Font License 1.1, (c) The Inter Project Authors. See `OFL.txt`.
- **IBM Plex Mono**: SIL Open Font License 1.1, (c) IBM Corp. See `OFL.txt`.
- **Noto Emoji**: SIL Open Font License 1.1, (c) The Noto Project Authors. See `OFL.txt`.
- **DejaVu Sans**: Bitstream Vera / Arev licence (permissive; DejaVu's own changes are public domain). See
  `DejaVu-LICENSE.txt`.

## To regenerate

Re-download the TTFs into this folder, then run the generator. Newsreader / Inter / IBM Plex Mono come from
the Fontsource CDN as static Latin TTFs; DejaVu + Noto Emoji as before:

```sh
FS=https://cdn.jsdelivr.net/fontsource/fonts
curl -sL -o Newsreader-Regular.ttf        "$FS/newsreader@latest/latin-400-normal.ttf"
curl -sL -o Newsreader-Italic.ttf         "$FS/newsreader@latest/latin-400-italic.ttf"
curl -sL -o Newsreader-SemiBold.ttf       "$FS/newsreader@latest/latin-600-normal.ttf"
curl -sL -o Newsreader-SemiBoldItalic.ttf "$FS/newsreader@latest/latin-600-italic.ttf"
curl -sL -o Inter-Regular.ttf             "$FS/inter@latest/latin-400-normal.ttf"
curl -sL -o Inter-SemiBold.ttf            "$FS/inter@latest/latin-600-normal.ttf"
curl -sL -o IBMPlexMono-Regular.ttf       "$FS/ibm-plex-mono@latest/latin-400-normal.ttf"
DV=https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf
curl -sL -o DejaVuSans.ttf "$DV/DejaVuSans.ttf"
curl -sL -o NotoEmoji-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf"
node ../scripts/gen-fonts-blob.mjs
```
