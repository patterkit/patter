// ---------------------------------------------------------------------------
// The character-colour model (Patterpad.md section 2 / design-language section 4):
// a stable hash of the name selects an *index* into the curated palette - repeatable
// and storage-free. The actual hues live in the APP-WIDE token layer (theme.css) as
// per-theme CSS variables `--char-0 .. --char-(N-1)`, so `colourFor` returns a
// `var(--char-N)` reference: the cue colour then adapts to light / dark (and any future
// curated palette) with zero JS - the hash only ever picks the slot.
//
// A cast member can also STORE a slot (`CastMember.colour`): a rename stamps the old
// name's hash there, so the character keeps their colour (the hands-on fixes review).
// `castColour` is the one lookup the page's cues use: the stored slot when the host has
// handed one over (`setCastColours`), else the hash.
//
// The hash and the palette are the shell's (ui-review-2026-09, finding 28): the bodies
// here were byte-identical to `@wildwinter/app-shell`'s, and a constant change in one
// fork would have recoloured this app's cast and not the other app's decks. Re-exported
// so `@patterkit/patterpad-surface/colour` and `../src/colour.js` keep resolving.
// ---------------------------------------------------------------------------

import { colourFor } from "@wildwinter/app-shell";

export { PALETTE, PALETTE_SIZE, colourIndex, colourFor, hashColour, isColourSlot } from "@wildwinter/app-shell";

/** The stored slots the host last handed over, by name (case-insensitive, as cues match the cast). */
let stored = new Map<string, number>();

/** Replace the stored colour slots (`{ BARKEEP: 4 }`, from the project's cast). Names with no slot hash. */
export function setCastColours(colours: Readonly<Record<string, number>> | undefined): void {
  stored = new Map(Object.entries(colours ?? {}).map(([name, slot]) => [name.toLowerCase(), slot]));
}

/** A speaker's cue colour (`var(--char-N)`): their stored slot when they have a valid one, else the hash. */
export function castColour(name: string): string {
  return colourFor(name, stored.get(name.toLowerCase()));
}
