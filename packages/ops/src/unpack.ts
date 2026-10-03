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
// A pack's game scopes snapshot (`game-scopes/<name>.scopes.json` entries, see pack.ts) is not source:
// EXTRACT puts it in `game-scopes/` inside the new project folder, where discovery looks first, and
// MERGE never writes it anywhere, since the sender's folder is the truth. A World edit the recipient
// made comes back in the project file instead, and MERGE takes it to `game.scopes.json`.
//
// A pack's open handoff records (`handoffs/<id>.json`, see pack.ts) are project files: EXTRACT writes
// them with the shards, and MERGE takes one the project lacks as it is, and for one it has, keeps ours and
// adds any reimports logged on their side (a record is otherwise fixed once written).
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
import { escapesTarget, isUnsafeEntry } from "@wildwinter/toolkit/archive";
import type { ProjectFile } from "@patterkit/model";
import { discoverGameScopes, planReturnedWorld, GAME_SCOPES_DIR, GAME_SCOPES_FILE } from "./game-scopes.js";
import { SCOPES_FILE_SUFFIX } from "@wildwinter/scoperegistry/scopes";
import { HANDOFF_DIR, parseHandoff, serialiseHandoff } from "./handoff.js";
import type { HandoffFile, HandoffImport } from "@patterkit/model";

const MANIFEST = "patter.manifest.json";

/** A game scopes snapshot entry: a scopes file directly in `game-scopes/`, which is all a pack writes
 *  there. Anything else under that folder is a shard, as it always was. */
const isScopesEntry = (name: string): boolean => {
  const rest = name.startsWith(`${GAME_SCOPES_DIR}/`) ? name.slice(GAME_SCOPES_DIR.length + 1) : undefined;
  return rest !== undefined && !rest.includes("/") && rest.endsWith(SCOPES_FILE_SUFFIX);
};

/** A handoff record entry: a `.json` directly in `handoffs/`, which is all a pack writes there. */
const isHandoffEntry = (name: string): boolean => {
  const rest = name.startsWith(`${HANDOFF_DIR}/`) ? name.slice(HANDOFF_DIR.length + 1) : undefined;
  return rest !== undefined && !rest.includes("/") && rest.endsWith(".json");
};

/** A document entry whose path escapes the target dir (rejected). */
export class UnsafeEntryError extends Error {}

/** A document's contents: its shards as relpath -> text (paths validated), its game scopes snapshot as
 *  entry name -> text (paths validated the same way), and its manifest when it has a readable one. One
 *  zip load for all three, since every caller that wants the manifest wants the shards. */
interface DocContents {
  shards: Map<string, string>;
  scopes: Map<string, string>;
  handoffs: Map<string, string>;
  manifest?: DocumentManifest;
}

async function readDoc(bytes: Buffer | Uint8Array): Promise<DocContents> {
  const zip = await JSZip.loadAsync(bytes);
  const shards = new Map<string, string>();
  const scopes = new Map<string, string>();
  const handoffs = new Map<string, string>();
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
    (isScopesEntry(name) ? scopes : isHandoffEntry(name) ? handoffs : shards).set(name, await entry.async("string"));
  }
  return { shards, scopes, handoffs, ...(manifest ? { manifest } : {}) };
}

/** What unpacking a document plans: its shards, and its game scopes snapshot (empty for a pack with none,
 *  which is every pack from before packs carried one). */
export interface UnpackResult {
  /** The shards, under `targetDir`, with any open handoff records the pack carries (`handoffs/`). */
  shards: PlannedWrite[];
  /** The game's scopes files, in `<targetDir>/game-scopes/`, where the new project finds them first. */
  scopes: PlannedWrite[];
}

/** Unpack a `.patterpack` document (zip bytes) into planned writes under `targetDir`. */
export async function runUnpack(bytes: Buffer | Uint8Array, targetDir: string): Promise<UnpackResult> {
  const doc = await readDoc(bytes);
  const plan = (entries: Map<string, string>): PlannedWrite[] => [...entries.entries()]
    .map(([name, content]) => ({ path: containedWrite(targetDir, name), content }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { shards: plan(new Map([...doc.shards, ...doc.handoffs])), scopes: plan(doc.scopes) };
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
  /** Merged (and added) shard contents to write into the project, and `game.scopes.json` when the
   *  recipient changed the game's scopes (`gameScopes`). */
  writes: PlannedWrite[];
  /** `.patterconflict` sidecars for shards with conflicts. */
  sidecars: PlannedWrite[];
  conflicts: number;
  warnings: number;
  /** Do the returned document, the base document and the target project agree on their project id? */
  provenance: ProvenanceCheck;
  /** The recipient changed the game's scopes (World properties) and the project has a game scopes
   *  folder: `path` is its `game.scopes.json`, which `writes` brings up to date, or, with `error`, the
   *  file that won't parse and so was left alone. Absent otherwise. */
  gameScopes?: { path: string; error?: string };
  /** Handoff records the pack brought (relative paths): added, or with reimports from their side added to
   *  ours. Their writes are in `writes`. Absent when the pack carried none that changed anything. */
  handoffs?: string[];
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
  // The project file's three sides, for the game's scopes (below): the one `.patterproj` at the root.
  const projectRel = projectEntry(theirs);
  let projectSides: { ours: ProjectFile; base: ProjectFile; theirs: ProjectFile; merged: ProjectFile } | undefined;

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
    if (rel === projectRel && baseText !== undefined) {
      projectSides = { ours: oursObj as unknown as ProjectFile, base: baseObj as unknown as ProjectFile, theirs: theirsObj as unknown as ProjectFile, merged: result.merged as unknown as ProjectFile };
    }
    if (result.conflicts.length > 0) {
      sidecars.push({ path: `${outPath}.patterconflict`, content: JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n" });
      conflicts += result.conflicts.length;
    }
    warnings += result.warnings.length;
    shards.push({ path: rel, result, added: false });
  }

  // The returned pack's game scopes snapshot is never written: the sender's folder stays the truth. But
  // a World edit the recipient made is in the project file's synced copy, and the sender's next save
  // would sync that copy from `game.scopes.json` and lose it, so it goes to the shared file now.
  let gameScopes: UnpackMergeResult["gameScopes"];
  const local = projectSides && discoverGameScopes(resolve(projectDir), projectSides.ours).gameScopes;
  if (projectSides && local) {
    const world = planReturnedWorld(projectSides.ours, projectSides.base, projectSides.theirs, projectSides.merged, local);
    if (world.write) { writes.push(world.write); gameScopes = { path: world.write.path }; }
    else if (world.error) gameScopes = { path: join(local.dir, GAME_SCOPES_FILE), error: world.error };
  }

  // Handoff records: theirs taken whole when we have none by that name, else ours with their reimports.
  const handoffs: string[] = [];
  for (const [rel, theirText] of [...returnedDoc.handoffs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = containedWrite(projectDir, rel);
    if (!existsSync(outPath)) {
      writes.push({ path: outPath, content: theirText });
      handoffs.push(rel);
      continue;
    }
    const merged = mergeHandoff(parseHandoff(readFileSync(outPath, "utf8")), parseHandoff(theirText));
    if (merged) { writes.push({ path: outPath, content: serialiseHandoff(merged) }); handoffs.push(rel); }
  }

  return { shards, writes, sidecars, conflicts, warnings, provenance, ...(gameScopes ? { gameScopes } : {}), ...(handoffs.length ? { handoffs } : {}) };
}

/** Our handoff record with any reimports their side logged that ours lacks, and closed if either side
 *  closed it. Undefined when that changes nothing. Everything else about a record is fixed at export. */
function mergeHandoff(ours: HandoffFile, theirs: HandoffFile): HandoffFile | undefined {
  const key = (i: HandoffImport): string => `${i.at}|${i.fileHash}`;
  const known = new Set((ours.imports ?? []).map(key));
  const added = (theirs.imports ?? []).filter((i) => !known.has(key(i)));
  const closed = ours.closed === true || theirs.closed === true;
  if (added.length === 0 && closed === (ours.closed === true)) return undefined;
  const imports = [...(ours.imports ?? []), ...added].sort((a, b) => a.at.localeCompare(b.at));
  return { ...ours, ...(imports.length ? { imports } : {}), ...(closed ? { closed: true } : {}) };
}

/** A document's project file: the one `.patterproj` at its root, or undefined when there isn't exactly one. */
function projectEntry(shards: Map<string, string>): string | undefined {
  const at = [...shards.keys()].filter((n) => !n.includes("/") && n.endsWith(".patterproj"));
  return at.length === 1 ? at[0] : undefined;
}

// The entry guards are @wildwinter/toolkit's. Both families had a correct copy,
// which is the state BEFORE a drift rather than proof there will not be one: a
// subtle weakening of one is a vulnerability nobody reads a diff for.
// Re-exported so nothing that imports it has to move.
export { isUnsafeEntry } from "@wildwinter/toolkit/archive";
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
