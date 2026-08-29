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
// validated twice: a screen on the entry NAME (no absolute paths, no `..`), and
// containment of the resolved WRITE PATH inside the target, which is the one
// that holds. See `isUnsafeEntry` / `containedWrite` at the foot of this file.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { join, normalize, isAbsolute, resolve, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { findProjectFile } from "./load.js";
import { runMerge } from "./merge.js";
import type { MergeResult } from "./merge.js";
import type { DocumentManifest } from "./pack.js";
import type { PlannedWrite } from "./write.js";

const MANIFEST = "patter.manifest.json";

/** A document entry whose path escapes the target dir (rejected). */
export class UnsafeEntryError extends Error {}

/** A document's contents: its shards as relpath -> text (paths validated), and its manifest when it has
 *  a readable one. One zip load for both, since every caller that wants the manifest wants the shards. */
interface DocContents {
  shards: Map<string, string>;
  manifest?: DocumentManifest;
}

async function readDoc(bytes: Buffer | Uint8Array): Promise<DocContents> {
  const zip = await JSZip.loadAsync(bytes);
  const shards = new Map<string, string>();
  let manifest: DocumentManifest | undefined;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (name === MANIFEST) {
      // A document from another tool, or a hand-made zip, may have no manifest or a broken one. That is
      // not a reason to refuse the merge; it only means we cannot vouch for where it came from.
      try { manifest = JSON.parse(await entry.async("string")) as DocumentManifest; } catch { /* unvouched */ }
      continue;
    }
    if (isUnsafeEntry(name)) throw new UnsafeEntryError(`document entry escapes the target directory: ${name}`);
    shards.set(name, await entry.async("string"));
  }
  return { shards, manifest };
}

/** Read a `.patterpack` document's shards as relpath -> text (manifest excluded, paths validated). */
async function readDocShards(bytes: Buffer | Uint8Array): Promise<Map<string, string>> {
  return (await readDoc(bytes)).shards;
}

/** Unpack a `.patterpack` document (zip bytes) into planned writes under `targetDir`. */
export async function runUnpack(bytes: Buffer | Uint8Array, targetDir: string): Promise<PlannedWrite[]> {
  const shards = await readDocShards(bytes);
  return [...shards.entries()]
    .map(([name, content]) => ({ path: containedWrite(targetDir, name), content }))
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

/**
 * Whether the three documents in a merge agree about WHICH PROJECT they are.
 *
 * The weak half of the provenance story (brief §7). A pack carries no record of the pack it descends
 * from, so nothing can tell you that you chose the wrong REVISION as your ancestor. But every manifest
 * already carries `project.id`, and until now nothing read it: you could point the merge at an entirely
 * unrelated project's pack and it would merge by id, find almost nothing in common, and hand back a
 * mountain of conflicts that read as though the other author had rewritten everything.
 *
 * The strong half (a content hash plus an `unpack` marker recording what a working copy came from) is
 * deliberately NOT built: it costs a non-shard file living inside every project folder, which is a
 * permanent intrusion into a tree kept to source shards on purpose. A wrong ancestor already fails soft,
 * as visible and recoverable conflicts.
 *
 * WARNS, never refuses. An id can legitimately differ - a project forked, or an id deliberately reissued
 * - and the author is better placed than we are to know.
 */
export interface ProvenanceCheck {
  /** The project id each side claims, or undefined where none could be read (no manifest, or no project
   *  file in the target). An id that cannot be read cannot disagree. */
  returned?: string;
  base?: string;
  target?: string;
  /** True when every id that COULD be read is the same one. */
  ok: boolean;
}

/** Compare the ids that are actually available. Silence when there is nothing to compare. */
function checkProvenance(returned?: string, base?: string, target?: string): ProvenanceCheck {
  const known = [returned, base, target].filter((id): id is string => typeof id === "string" && id !== "");
  return {
    ...(returned !== undefined ? { returned } : {}),
    ...(base !== undefined ? { base } : {}),
    ...(target !== undefined ? { target } : {}),
    ok: new Set(known).size <= 1,
  };
}

/** The open project's own id, for the target side of the check. Undefined when there is no project file
 *  to read - `runUnpackMerge` is happy to merge into a bare directory, so this must not throw. */
function targetProjectId(projectDir: string): string | undefined {
  try {
    const pf = parseSource(readFileSync(findProjectFile(projectDir), "utf8")) as { project?: { id?: string } };
    return pf.project?.id;
  } catch {
    return undefined;
  }
}

export interface UnpackMergeResult {
  shards: MergedShard[];
  /** Merged (and added) shard contents to write into the project. */
  writes: PlannedWrite[];
  /** `.patterconflict` sidecars for shards with conflicts. */
  sidecars: PlannedWrite[];
  conflicts: number;
  warnings: number;
  /** Do the returned document, the base document and the target project agree on their project id? */
  provenance: ProvenanceCheck;
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
  const returnedDoc = await readDoc(returnedBytes);
  const baseDoc = await readDoc(baseBytes);
  const theirs = returnedDoc.shards;
  const base = baseDoc.shards;
  const provenance = checkProvenance(returnedDoc.manifest?.project?.id, baseDoc.manifest?.project?.id, targetProjectId(projectDir));
  const shards: MergedShard[] = [];
  const writes: PlannedWrite[] = [];
  const sidecars: PlannedWrite[] = [];
  let conflicts = 0, warnings = 0;

  for (const [rel, theirText] of [...theirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = containedWrite(projectDir, rel);
    if (!existsSync(outPath)) {
      // The author added a file we do not have - take it verbatim.
      writes.push({ path: outPath, content: theirText });
      shards.push({ path: rel, added: true });
      continue;
    }
    // A three-way merge cannot proceed over a shard it cannot read, and half-merging a return leg is
    // worse than refusing it - so this still aborts the whole run. What it did NOT do was say WHICH
    // file or WHICH of the three sides was unreadable, and this is a call the author made on a whole
    // project, so the error was "unexpected token" with no way to tell where. (from-storylets/
    // merge-holes-worth-checking, found in their tree and true in ours.)
    const readSide = (side: "ours" | "theirs" | "base", text: string): Record<string, unknown> => {
      try { return parseSource(text) as Record<string, unknown>; }
      catch (e) { throw new Error(`${rel}: the ${side} copy is not readable Patter source - ${e instanceof Error ? e.message : String(e)}`); }
    };
    const oursObj = readSide("ours", readFileSync(outPath, "utf8"));
    const theirsObj = readSide("theirs", theirText);
    const baseText = base.get(rel);
    const baseObj = baseText !== undefined ? readSide("base", baseText) : {};

    const result = runMerge(baseObj, oursObj, theirsObj);
    writes.push({ path: outPath, content: canonicalStringify(result.merged) });
    if (result.conflicts.length > 0) {
      sidecars.push({ path: `${outPath}.patterconflict`, content: JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n" });
      conflicts += result.conflicts.length;
    }
    warnings += result.warnings.length;
    shards.push({ path: rel, result, added: false });
  }

  return { shards, writes, sidecars, conflicts, warnings, provenance };
}

/** True if a document entry is an absolute path or would escape the target dir.
 *
 *  A screen on the NAME, and the cheap half of the answer. `containedWrite` below is the check that
 *  actually holds, because a name is not a path: this cannot know what the name resolves to once it is
 *  joined to a target, and `normalize` does not treat `\` as a separator away from Windows.
 *
 *  Note what normalises, because the comment here used to credit the wrong half: it is JSZip's READER,
 *  not its writer, that collapses `..`. A traversal entry does not survive `loadAsync` however the zip
 *  was produced, so neither this nor `containedWrite` can currently be reached through it. They are
 *  kept for a different zip library or a future JSZip, and `pack.test.ts` pins the normalisation so
 *  that assumption fails loudly rather than silently. */
export function isUnsafeEntry(name: string): boolean {
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return true;
  const norm = normalize(name);
  return norm === ".." || norm.startsWith(".." + sep) || norm.startsWith("../");
}

/**
 * Join `name` onto `dir` and refuse the result unless it lands INSIDE `dir`.
 *
 * This is the guard that holds, and it is deliberately at the point the write path is FORMED rather
 * than where the entry is read: containment of a resolved path is a fact about the write, where a
 * judgement about a name is a guess about one. Every path handed back by the two ops below goes
 * through here.
 */
function containedWrite(dir: string, name: string): string {
  const root = resolve(dir);
  const full = resolve(join(dir, name));
  if (full !== root && !full.startsWith(root + sep)) {
    throw new UnsafeEntryError(`document entry escapes the target directory: ${name}`);
  }
  return full;
}
