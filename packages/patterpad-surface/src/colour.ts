// ---------------------------------------------------------------------------
// The character-colour model (Patterpad.md section 2 / design-language section 4):
// a stable hash of the name selects an *index* into the curated palette - repeatable
// and storage-free. The actual hues live in the APP-WIDE token layer (theme.css) as
// per-theme CSS variables `--char-0 .. --char-(N-1)`, so `colourFor` returns a
// `var(--char-N)` reference: the cue colour then adapts to light / dark (and any future
// curated palette) with zero JS - the hash only ever picks the slot.
//
// The hash and the palette are the shell's (ui-review-2026-09, finding 28): the bodies
// here were byte-identical to `@wildwinter/app-shell`'s, and a constant change in one
// fork would have recoloured this app's cast and not the other app's decks. Re-exported
// so `@patterkit/patterpad-surface/colour` and `../src/colour.js` keep resolving.
// ---------------------------------------------------------------------------

export { PALETTE, PALETTE_SIZE, colourIndex, colourFor } from "@wildwinter/app-shell";
