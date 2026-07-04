// ---------------------------------------------------------------------------
// The unpack op (spec §10 / schema §2.1): explode a `.patterpack` document back
// into source shards. The inverse of `pack` - the return leg of the Word
// round-trip.
//
// Two modes:
//   - EXTRACT (`runUnpack`): write the document's shards into a target dir.
//   - MERGE (`runUnpackMerge`): fold a RETURNED document's edits back into an
//     existing working copy via the id-keyed 3-way engine. The common ancestor
//     (BASE) comes from the document the team packed and sent (`--base`); the
//     team keeps it in their outbox, so the round-trip is self-contained with no
//     VCS lookup. (Embedding BASE in the returned document is a future
//     editor-integration refinement.)
//
// A document may arrive from an untrusted external author, so entry paths are
// validated: no absolute paths, no `..` traversal, no escaping the target.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { join, normalize, isAbsolute, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { runMerge } from "./merge.js";
import type { MergeResult } from "./merge.js";
import type { PlannedWrite } from "./write.js";

const MANIFEST = "patter.manifest.json";

/** A document entry whose path escapes the target dir (rejected). */
export class UnsafeEntryError extends Error {}

/** Read a `.patterpack` document's shards as relpath -> text (manifest excluded, paths validated). */
async function readDocShards(bytes: Buffer | Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === MANIFEST) continue;
    if (isUnsafeEntry(name)) throw new UnsafeEntryError(`document entry escapes the target directory: ${name}`);
    out.set(name, await entry.async("string"));
  }
  return out;
}

/** Unpack a `.patterpack` document (zip bytes) into planned writes under `targetDir`. */
export async function runUnpack(bytes: Buffer | Uint8Array, targetDir: string): Promise<PlannedWrite[]> {
  const shards = await readDocShards(bytes);
  return [...shards.entries()]
    .map(([name, content]) => ({ path: join(targetDir, name), content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** One shard's outcome in a merge-unpack. */
export interface MergedShard {
  /** Relative path within the project. */
  path: string;
  /** Merge result, or undefined when the shard was ADDED (new file from the author). */
  result?: MergeResult;
  added: boolean;
}

export interface UnpackMergeResult {
  shards: MergedShard[];
  /** Merged (and added) shard contents to write into the project. */
  writes: PlannedWrite[];
  /** `.patterconflict` sidecars for shards with conflicts. */
  sidecars: PlannedWrite[];
  conflicts: number;
  warnings: number;
}

/**
 * Merge a RETURNED `.patterpack` document (`theirs`) back into the project at
 * `projectDir` (`ours`), using the document originally sent (`base`) as the
 * common ancestor. Per shard: 3-way merge (added files written verbatim). Pure -
 * returns planned writes + sidecars; the caller commits. A shard the author
 * DELETED is left in the working tree (whole-file deletes are not propagated in
 * v1 - safe, no data loss).
 */
export async function runUnpackMerge(
  returnedBytes: Buffer | Uint8Array,
  baseBytes: Buffer | Uint8Array,
  projectDir: string,
): Promise<UnpackMergeResult> {
  const theirs = await readDocShards(returnedBytes);
  const base = await readDocShards(baseBytes);
  const shards: MergedShard[] = [];
  const writes: PlannedWrite[] = [];
  const sidecars: PlannedWrite[] = [];
  let conflicts = 0, warnings = 0;

  for (const [rel, theirText] of [...theirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = join(projectDir, rel);
    if (!existsSync(outPath)) {
      // The author added a file we do not have - take it verbatim.
      writes.push({ path: outPath, content: theirText });
      shards.push({ path: rel, added: true });
      continue;
    }
    const oursObj = parseSource(readFileSync(outPath, "utf8")) as Record<string, unknown>;
    const theirsObj = parseSource(theirText) as Record<string, unknown>;
    const baseText = base.get(rel);
    const baseObj = (baseText !== undefined ? parseSource(baseText) : {}) as Record<string, unknown>;

    const result = runMerge(baseObj, oursObj, theirsObj);
    writes.push({ path: outPath, content: canonicalStringify(result.merged) });
    if (result.conflicts.length > 0) {
      sidecars.push({ path: `${outPath}.patterconflict`, content: JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n" });
      conflicts += result.conflicts.length;
    }
    warnings += result.warnings.length;
    shards.push({ path: rel, result, added: false });
  }

  return { shards, writes, sidecars, conflicts, warnings };
}

/** True if a document entry is an absolute path or would escape the target dir.
 *  (JSZip's own API normalises `..` away, but a zip from any other tool may not.) */
export function isUnsafeEntry(name: string): boolean {
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return true;
  const norm = normalize(name);
  return norm === ".." || norm.startsWith(".." + sep) || norm.startsWith("../");
}
