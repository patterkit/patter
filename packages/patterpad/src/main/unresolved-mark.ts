// ---------------------------------------------------------------------------
// The `unresolved` mark a merge writes into a shard (ruled 2026-10-18, in every shard type), kept across
// Patterpad's own writes. The editor rebuilds a scene's flow and loc shards from its model, which has no
// place for the mark, so a save after a merge would quietly drop it and with it the one record that the
// shard holds our side of a clash. Validate, export, and pack refuse a marked shard; resolving it is the
// author's to do, by removing the entry, never a save's.
// ---------------------------------------------------------------------------

import { canonicalStringify, parseSource } from "@patterkit/core";
import { UNRESOLVED_KEY } from "@patterkit/model";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `next` (a shard's new text) with the mark the file on disk carries, when it carries one and `next` has
 *  none. Anything that won't parse, or nothing to carry, gives back `next` as it is. */
export function keepUnresolvedMark(onDisk: string | null, next: string): string {
  if (onDisk === null || !onDisk.includes(UNRESOLVED_KEY)) return next; // the cheap test: almost no shard has one
  let disk: unknown, out: unknown;
  try { disk = parseSource(onDisk); out = parseSource(next); } catch { return next; }
  if (!isObj(disk) || !Object.prototype.hasOwnProperty.call(disk, UNRESOLVED_KEY)) return next;
  if (!isObj(out) || Object.prototype.hasOwnProperty.call(out, UNRESOLVED_KEY)) return next;
  return canonicalStringify({ ...out, [UNRESOLVED_KEY]: disk[UNRESOLVED_KEY] });
}
