// ---------------------------------------------------------------------------
// The format op: compute the canonical form of source files (spec §10).
//
// Pure: never writes - each changed file comes back as a planned write for the
// caller to commit (CLI `format`), check (CI `format --check`), or preview
// (Patterpad). Parse failures throw.
//
// Only Patter SOURCE is formatted: the shards, by extension. Canonical form is
// JSON5 with trailing commas, which is right for source and wrong for anything a
// stock JSON parser reads: the compiled bundle, a game's scopes files, a handoff
// record, the audio sidecar. `patter format $(git ls-files)` rewrote them all,
// and every runtime then refused the bundle. Anything else passed in is skipped.
// A directory (a project folder) means every shard in it.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { findProjectFile, walkFiles } from "./load.js";
import { SHARD_EXTENSIONS } from "./pack.js";
import type { PlannedWrite } from "./write.js";

export interface FormatResult {
  file: string;
  changed: boolean;
  /** The canonical content to commit - present only when `changed`. */
  write?: PlannedWrite;
  /** Not Patter source (not a shard by its extension), so left alone. */
  skipped?: boolean;
}

const isShard = (file: string): boolean => SHARD_EXTENSIONS.some((ext) => file.endsWith(ext));

/** The files a path names: itself, or every shard in the project at or above a directory. */
function expand(path: string): string[] {
  let dir = false;
  try { dir = statSync(path).isDirectory(); } catch { /* read below reports it */ }
  if (!dir) return [path];
  const root = dirname(findProjectFile(path));
  return SHARD_EXTENSIONS.flatMap((ext) => walkFiles(root, ext)).sort();
}

/** Compute the canonical form of each file. Returns planned writes; writes nothing. */
export function runFormat(paths: string[]): FormatResult[] {
  return paths.flatMap(expand).map((file) => {
    if (!isShard(file)) return { file, changed: false, skipped: true };
    const original = readFileSync(file, "utf8");
    let canonical: string;
    try {
      canonical = canonicalStringify(parseSource(original));
    } catch (e) {
      throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const changed = canonical !== original;
    return changed ? { file, changed, write: { path: file, content: canonical } } : { file, changed };
  });
}
