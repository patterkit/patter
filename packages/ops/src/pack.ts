// ---------------------------------------------------------------------------
// The pack op (spec §10 / schema §2.1): snapshot a sharded project into a
// single portable `.patterpack` DOCUMENT - the send-and-return envelope for non-VCS
// authors (the Word round-trip). A binary zip container (OPC/.docx-style: a
// manifest + the canonical source shards), so it can't be sharded-merged and
// nobody mistakes it for source. `unpack` is the inverse.
//
// v1 packs the text shards (.patterflow / .patterloc / .patterx / .patterproj)
// and a manifest; embedded `assets/` (scratch audio) is a documented later
// addition. RAW file bytes are zipped - lossless, preserving any hand-edits /
// comments rather than re-serialising through the model.
//
// Where the project has a game scopes folder (patterkit/design/shared-scopes.md), the pack carries a
// read-only snapshot of it too, as `game-scopes/<file>` entries, so the recipient's checks, pickers, and
// previews know the other tools' scopes. A project with no folder packs exactly as it always did.
//
// Open editable-script handoff records (`handoffs/<id>.json`, handoff.ts) ride along as they are, so
// whoever opens the pack can reimport the editor's file. Closed ones stay home.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parseSource } from "@patterkit/core";
import { EXTENSION_SHARD, EXTENSIONS_DIR, MANIFEST_EXTENSION } from "@patterkit/model";
import type { ProjectFile } from "@patterkit/model";
import { findProjectFile, walkFiles } from "./load.js";
import { sidecarIssues, unresolvedMarkIssues, CONFLICT_SIDECAR } from "./merge.js";
import { ARCHIVE_ENTRY_OPTS } from "@wildwinter/toolkit/archive";
import { gameScopesSnapshot, GAME_SCOPES_DIR } from "./game-scopes.js";
import { HANDOFF_DIR, parseHandoff } from "./handoff.js";

/** The source-shard extensions a document carries (the merge-friendly truth). */
export const SHARD_EXTENSIONS = [".patterflow", ".patterloc", ".patterx", ".patterproj", EXTENSION_SHARD] as const;

/** Manifest embedded at the document root - what this envelope is and contains. */
export interface DocumentManifest {
  schema: "patter/document@0";
  project: { id: string; name: string };
  /** Shard paths (relative, forward-slashed), sorted - the document's contents. The extensions' manifests
   *  (`extensions/<id>.extension.json`) are among them: source the project compiles from. */
  files: string[];
  /** The game scopes files the pack carries as `game-scopes/<name>` entries, by name, sorted. Absent
   *  when the project has no game scopes folder (or it holds none). */
  gameScopes?: string[];
  /** The open handoff records the pack carries as `handoffs/<id>.json` entries, by entry name, sorted.
   *  Absent when there are none. */
  handoffs?: string[];
}

// A fixed timestamp keeps the zip byte-reproducible (no wall-clock mtimes), so
// re-packing unchanged source yields an identical document. createFolders must
// stay off: JSZip stamps implicit folder entries with new Date() regardless of
// the file's `date` option, which leaks wall-clock time into the bytes.
// The reproducibility settings are @wildwinter/toolkit's: a fixed entry date
// and no folder entries, so an unchanged project packs to the same bytes.
const ENTRY_OPTS = ARCHIVE_ENTRY_OPTS;

/** Pack a project's source shards into a `.patterpack` document (zip bytes). */
export async function runPack(startPath: string): Promise<Buffer> {
  const projectFile = findProjectFile(startPath);
  const root = dirname(projectFile);
  const project = parseSource(readFileSync(projectFile, "utf8")) as ProjectFile;

  // Refuse a pack built over an unresolved merge (patter-merge.md §3.6, via `sidecarIssues`). This is
  // the worse of the two holes that rule left: a pack carries SHARDS and not sidecars, so the
  // recipient gets conflicted values provisionally resolved to our side with nothing at all to say
  // they were in dispute - and somebody else opening it is the whole point of a pack.
  const unresolved = sidecarIssues(walkFiles(root, CONFLICT_SIDECAR));
  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} unresolved merge conflict(s) - resolve them before packing, or the recipient ` +
      `gets your side of a disagreement with no sign of it:\n` +
      unresolved.map((i) => `  ${i.file}`).join("\n"),
    );
  }

  // Gather every source shard under the project root, layout-independent.
  const shardFiles = SHARD_EXTENSIONS.flatMap((ext) => walkFiles(root, ext))
    .map((abs) => ({ abs, rel: relative(root, abs).split(sep).join("/") }));

  // The same rule for the mark a merge writes into a shard (`unresolved`), which is the record that
  // travels where a sidecar does not: it would reach the recipient inside the very shard it marks.
  const marked = [...new Set(unresolvedMarkIssues(shardFiles.map((f) => ({ file: f.rel, text: readFileSync(f.abs, "utf8") }))).map((i) => i.file))];
  if (marked.length) {
    throw new Error(
      `${marked.length} shard(s) still marked with an unresolved merge - resolve the clashes each names under ` +
      `"unresolved", then remove the entries, before packing:\n` +
      marked.map((f) => `  ${f}`).join("\n"),
    );
  }

  // ...and the extensions' manifests, which a project compiles from as it does from its shards: a pack
  // without them would hand the recipient extension data nothing can check or compile.
  const files = [...shardFiles, ...extensionManifests(root)].sort((a, b) => a.rel.localeCompare(b.rel));

  // The game's scopes, found as the loader finds them: a snapshot the recipient reads and never sends back.
  const scopes = gameScopesSnapshot(root, project);

  // Open handoff records, raw. One that won't parse can't say whether it is open, so it stays home too;
  // the project's own checks report it.
  const handoffs = walkFiles(join(root, HANDOFF_DIR), ".json")
    .map((abs) => ({ rel: relative(root, abs).split(sep).join("/"), text: readFileSync(abs, "utf8") }))
    .filter((f) => { try { return !parseHandoff(f.text).closed; } catch { return false; } });

  const manifest: DocumentManifest = {
    schema: "patter/document@0",
    project: { id: project.project.id, name: project.project.name },
    files: files.map((f) => f.rel),
    ...(scopes.length ? { gameScopes: scopes.map((f) => f.fileName) } : {}),
    ...(handoffs.length ? { handoffs: handoffs.map((f) => f.rel) } : {}),
  };

  const zip = new JSZip();
  zip.file("patter.manifest.json", JSON.stringify(manifest, null, 2) + "\n", ENTRY_OPTS);
  for (const f of files) zip.file(f.rel, readFileSync(f.abs, "utf8"), ENTRY_OPTS);
  for (const f of scopes) zip.file(`${GAME_SCOPES_DIR}/${f.fileName}`, f.text, ENTRY_OPTS);
  for (const f of handoffs) zip.file(f.rel, f.text, ENTRY_OPTS);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: false });
}

/** A project's extension manifests, as the loader finds them: `extensions/<id>.extension.json`, one level. */
function extensionManifests(root: string): Array<{ abs: string; rel: string }> {
  let names: string[];
  try {
    names = readdirSync(join(root, EXTENSIONS_DIR), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name.endsWith(MANIFEST_EXTENSION)).map((e) => e.name);
  } catch { return []; }
  return names.map((name) => ({ abs: join(root, EXTENSIONS_DIR, name), rel: `${EXTENSIONS_DIR}/${name}` }));
}

/** Whether a pack entry is an extension's manifest: `extensions/<id>.extension.json`, directly in the folder. */
export const isManifestEntry = (name: string): boolean => {
  const rest = name.startsWith(`${EXTENSIONS_DIR}/`) ? name.slice(EXTENSIONS_DIR.length + 1) : undefined;
  return rest !== undefined && !rest.includes("/") && rest.endsWith(MANIFEST_EXTENSION) && rest.length > MANIFEST_EXTENSION.length;
};
