// ---------------------------------------------------------------------------
// Slug + hash helpers.
//
// `slug` turns an author name into a filename- / address-safe segment (used by
// the Game ID / address derivation and for file stems). `hash4` / `hash32` are
// deterministic FNV-1a base-36 digests (e.g. the compiled bundle's content hash).
//
// NOTE: Patter has NO location-derived "handle" identifier. A node's IDENTITY is
// its opaque id (ids.ts); its host-facing readable ADDRESS is the gameId
// (effectiveGameId). Both are stable, and neither encodes the (mutable)
// scene/block location, so nothing breaks when content moves. To show a human
// WHERE a node lives, compose its scene/block names + text at DISPLAY time (see
// the search / resolve index) - never bake location into a stored string.
// ---------------------------------------------------------------------------

/** Slugify an author name into a filename- / address-safe segment. */
export function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "_";
}

function fnv32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 4-char base-36 hash of a string (FNV-1a 32-bit). */
export function hash4(input: string): string {
  return fnv32(input).toString(36).slice(-4).padStart(4, "0");
}

/** Deterministic 7-char base-36 hash of a string (full FNV-1a 32-bit width) - e.g. content hashes. */
export function hash32(input: string): string {
  return fnv32(input).toString(36).padStart(7, "0");
}
