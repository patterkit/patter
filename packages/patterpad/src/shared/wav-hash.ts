// Portable WAV text-hash helpers (#224), shared by the renderer (stamping a take) and the main-process
// indexer (reading the stamp back to flag a stale scratch take). No DOM / Web Audio - just byte work - so
// it runs in both processes. The format matches dink/dinky: an FNV-1a text hash stored in a LIST/INFO/DINK
// chunk, so takes recorded in either tool compare equal.

/** Normalise line text before hashing so only a real WORDING change restales a take: inline formatting
 *  tags, punctuation, and whitespace changes are all ignored (they don't alter what's spoken). Cross-tool
 *  parity (dink/dinky) requires the same normalisation there. */
function normalizeForHash(input: string): string {
  return input
    .replace(/<\/?(?:b|i|bi)>/g, "")   // inline formatting tags (<b>/<i>/<bi>) are not spoken
    .replace(/[^\p{L}\p{N}\s]/gu, "")  // drop punctuation / symbols (keep letters + numbers, any language)
    .replace(/\s+/g, " ")              // collapse whitespace runs to a single space
    .trim();
}

/** FNV-1a (32-bit) of the NORMALISED line text -> 4 little-endian bytes -> base64 -> first 6 chars.
 *  Empty (after normalising) -> "000000". */
export function textHash(input: string): string {
  const text = normalizeForHash(input);
  if (!text) return "000000";
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  const bytes = [hash & 0xff, (hash >>> 8) & 0xff, (hash >>> 16) & 0xff, (hash >>> 24) & 0xff];
  return btoa(String.fromCharCode(...bytes)).slice(0, 6);
}

/** Read the DINK text-hash stamped into a WAV's LIST/INFO chunk, or null if absent. Walks the RIFF chunks
 *  (dink's `readHashFromWav` approach) so it works whether the chunk sits before or after the audio data. */
export function readDinkHash(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number, n: number): string => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(o + i)); return s; };
  if (bytes.length < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = ascii(pos, 4);
    const size = view.getUint32(pos + 4, true);
    pos += 8;
    if (id === "LIST" && pos + 4 <= bytes.length && ascii(pos, 4) === "INFO") {
      let sub = pos + 4;
      const listEnd = pos + size;
      while (sub + 8 <= listEnd && sub + 8 <= bytes.length) {
        const subId = ascii(sub, 4);
        const subSize = view.getUint32(sub + 4, true);
        sub += 8;
        if (subId === "DINK") {
          let s = "";
          for (let i = 0; i < subSize && sub + i < bytes.length; i++) s += String.fromCharCode(view.getUint8(sub + i));
          return s.replace(/\0+$/, "");
        }
        sub += subSize + (subSize % 2); // word-aligned
      }
    }
    pos += size + (size % 2);
  }
  return null;
}
