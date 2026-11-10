// ---------------------------------------------------------------------------
// Audio take stamps: what a take was made from, kept inside the WAV itself so there's no manifest of our own
// to drift. Pure byte work (no DOM, no Node), so Patterpad's renderer, its main process, ops, and the CLI all
// share one implementation.
//
// A stamp is a LIST/INFO sub-chunk:
//   PTRK  the text hash of the line the take speaks (every take Patter tools stamp: scratch and Placeholder
//         Speech). Read as "out of date" when it no longer matches the line.
//   PTPS  Placeholder Speech's request hash (text, voice, language, rate, format): marks a take as generated,
//         so ours to remake or remove. A take without it is a person's, never touched.
// Patterstage's voice-takes marks its own generated takes with PSVT: read as PTPS, never written. (The text hash's
// first name, DINK, from Dink and earlier Patterpads, isn't read: Ian, 2026-11-10.)
// ---------------------------------------------------------------------------

/** The text-hash stamp's chunk id. */
export const TEXT_STAMP = "PTRK";
/** Placeholder Speech's request-hash stamp, and Patterstage's name for the same thing. */
export const GENERATED_STAMP = "PTPS";
const GENERATED_STAMP_OTHER = "PSVT";

/** Normalise line text before hashing so only a real WORDING change makes a take out of date: inline formatting
 *  tags, punctuation, and whitespace changes are all ignored (they don't alter what's spoken). Every tool that
 *  stamps must normalise the same way for its hashes to compare equal. */
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

const ascii = (bytes: Uint8Array, at: number, n: number): string => {
  let s = "";
  for (let i = 0; i < n && at + i < bytes.length; i++) s += String.fromCharCode(bytes[at + i]!);
  return s;
};
const u32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

/** Whether the bytes start as a RIFF/WAVE file. */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
}

/** Every LIST/INFO sub-chunk in a WAV, by id, as text (trailing NULs dropped). Walks the RIFF chunks, so it
 *  works wherever the list sits. Empty for anything that isn't a WAV. Reading only needs the file's chunk
 *  headers and the list itself, so a caller may pass just the head of a large file when the list comes first. */
export function readInfoChunks(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  if (!isWav(bytes)) return out;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = u32(bytes, pos + 4);
    const body = pos + 8;
    if (id === "LIST" && ascii(bytes, body, 4) === "INFO") {
      const end = Math.min(body + size, bytes.length);
      let sub = body + 4;
      while (sub + 8 <= end) {
        const subId = ascii(bytes, sub, 4);
        const subSize = u32(bytes, sub + 4);
        out.set(subId, ascii(bytes, sub + 8, subSize).replace(/\0+$/, ""));
        sub += 8 + subSize + (subSize % 2); // word-aligned
      }
    }
    pos = body + size + (size % 2);
  }
  return out;
}

/** A take's text-hash stamp (`PTRK`), or null when it has none. */
export function readTextStamp(bytes: Uint8Array): string | null {
  const info = readInfoChunks(bytes);
  return info.get(TEXT_STAMP) ?? null;
}

/** A take's generated-speech stamp (`PTPS`, else Patterstage's `PSVT`), or null for a person's take. */
export function readGeneratedStamp(bytes: Uint8Array): string | null {
  const info = readInfoChunks(bytes);
  return info.get(GENERATED_STAMP) ?? info.get(GENERATED_STAMP_OTHER) ?? null;
}

/** A LIST/INFO chunk holding these sub-chunks, in order. Each value is written as ASCII with a NUL terminator
 *  and padded to an even length, as RIFF wants. */
export function infoListChunk(stamps: Array<[string, string]>): Uint8Array {
  const parts = stamps.map(([id, value]) => {
    const data = new TextEncoder().encode(value + "\0");
    const padded = data.length + (data.length % 2);
    const sub = new Uint8Array(8 + padded);
    for (let i = 0; i < 4; i++) sub[i] = id.charCodeAt(i);
    new DataView(sub.buffer).setUint32(4, data.length, true);
    sub.set(data, 8);
    return sub;
  });
  const content = 4 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + content);
  const view = new DataView(out.buffer);
  out.set([76, 73, 83, 84], 0); // "LIST"
  view.setUint32(4, content, true);
  out.set([73, 78, 70, 79], 8); // "INFO"
  let at = 12;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The same WAV with its LIST/INFO chunks replaced by one holding `stamps` (any other INFO entries, such as an
 *  encoder's, are dropped), appended after the audio, with the RIFF size fixed. Throws on bytes that aren't a
 *  WAV. */
export function withStamps(wav: Uint8Array, stamps: Array<[string, string]>): Uint8Array {
  if (!isWav(wav)) throw new Error("not a WAV file");
  const kept: Uint8Array[] = [];
  let pos = 12;
  while (pos + 8 <= wav.length) {
    const id = ascii(wav, pos, 4);
    const size = u32(wav, pos + 4);
    const next = Math.min(pos + 8 + size + (size % 2), wav.length);
    if (!(id === "LIST" && ascii(wav, pos + 8, 4) === "INFO")) kept.push(wav.subarray(pos, next));
    pos = next;
  }
  const list = infoListChunk(stamps);
  const total = 12 + kept.reduce((n, c) => n + c.length, 0) + list.length;
  const out = new Uint8Array(total);
  out.set(wav.subarray(0, 12), 0);
  let at = 12;
  for (const c of kept) { out.set(c, at); at += c.length; }
  out.set(list, at);
  new DataView(out.buffer).setUint32(4, total - 8, true);
  return out;
}
