// ---------------------------------------------------------------------------
// The character-colour model (Patterpad.md section 2 / design-language section 4):
// a stable hash of the name selects an *index* into the curated palette - repeatable
// and storage-free. The actual hues live in the APP-WIDE token layer (theme.css) as
// per-theme CSS variables `--char-0 .. --char-(N-1)`, so `colourFor` returns a
// `var(--char-N)` reference: the cue colour then adapts to light / dark (and any future
// curated palette) with zero JS - the hash only ever picks the slot.
// ---------------------------------------------------------------------------

/** Number of curated character-colour slots. Must match the `--char-*` set defined per theme.
 *  12 (not 8) - more slots means fewer collisions across a typical cast; the hues are stepped
 *  around the wheel (theme.css) so adjacent slots read as clearly different. */
export const PALETTE_SIZE = 12;

/** The palette as theme-aware CSS variable references - one per curated slot. */
export const PALETTE = Array.from({ length: PALETTE_SIZE }, (_, i) => `var(--char-${i})`) as readonly string[];

/**
 * Hash a name to a palette slot. FNV-1a + an fmix32 avalanche so the result is well-distributed
 * across the slots even for short, similar uppercase names - the plain `*31 % n` it replaced
 * clustered in the low bits, so distinct names kept landing on the same slot.
 */
export function colourIndex(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % PALETTE_SIZE;
}

export function colourFor(name: string): string {
  return PALETTE[colourIndex(name)]!;
}
