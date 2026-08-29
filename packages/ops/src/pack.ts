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
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { parseSource } from "@patterkit/core";
import type { ProjectFile } from "@patterkit/model";
import { findProjectFile, walkFiles } from "./load.js";
import { sidecarIssues, CONFLICT_SIDECAR } from "./merge.js";

/** The source-shard extensions a document carries (the merge-friendly truth). */
export const SHARD_EXTENSIONS = [".patterflow", ".patterloc", ".patterx", ".patterproj"] as const;

/** Manifest embedded at the document root - what this envelope is and contains. */
export interface DocumentManifest {
  schema: "patter/document@0";
  project: { id: string; name: string };
  /** Shard paths (relative, forward-slashed), sorted - the document's contents. */
  files: string[];
}

// A fixed timestamp keeps the zip byte-reproducible (no wall-clock mtimes), so
// re-packing unchanged source yields an identical document. createFolders must
// stay off: JSZip stamps implicit folder entries with new Date() regardless of
// the file's `date` option, which leaks wall-clock time into the bytes.
const FIXED_DATE = new Date("2000-01-01T00:00:00Z");
const ENTRY_OPTS = { date: FIXED_DATE, createFolders: false } as const;

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
  const files = SHARD_EXTENSIONS.flatMap((ext) => walkFiles(root, ext))
    .map((abs) => ({ abs, rel: relative(root, abs).split(sep).join("/") }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const manifest: DocumentManifest = {
    schema: "patter/document@0",
    project: { id: project.project.id, name: project.project.name },
    files: files.map((f) => f.rel),
  };

  const zip = new JSZip();
  zip.file("patter.manifest.json", JSON.stringify(manifest, null, 2) + "\n", ENTRY_OPTS);
  for (const f of files) zip.file(f.rel, readFileSync(f.abs, "utf8"), ENTRY_OPTS);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: false });
}
