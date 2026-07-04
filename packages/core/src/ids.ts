// ---------------------------------------------------------------------------
// Stable, immutable, opaque ids (spec §6, §10).
//
// Generated at creation, never derived from content or position - so it survives
// moving, renaming, and reordering a node. A short, collision-resistant base-36
// token. An optional type prefix (e.g. "scn", "sn", "L") aids debugging /
// reverse-lookup but is not semantically required. The id is the node's IDENTITY
// (loc keys, jump targets, audio filenames, save data, edit trail all key on it);
// its host-facing readable ADDRESS is the gameId (see model `effectiveGameId`).
// ---------------------------------------------------------------------------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Generate a new opaque id, e.g. `newId("scn") -> "scn_8f3kq2z1"`. */
export function newId(prefix = "", length = 8): string {
  // Rejection-sample so every alphabet character is equally likely (a plain
  // byte % 36 over-weights the first four characters).
  const limit = 256 - (256 % ALPHABET.length); // 252
  let token = "";
  while (token.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      token += ALPHABET[b % ALPHABET.length];
      if (token.length === length) break;
    }
  }
  return prefix ? `${prefix}_${token}` : token;
}
