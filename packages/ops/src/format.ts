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
// A directory (a project folder) means every shard in it, and on a project
// folder format also takes each Patter extension whose manifest has moved past
// the project's pin: the stages it renamed renamed in its data, and the pin
// moved, in one step (extensions.ts). An extension's manifest is never
// formatted: it is the extension's own JSON.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { findProjectFile, loadProject, walkFiles } from "./load.js";
import { planExtensionUpgrades } from "./extensions.js";
import { SHARD_EXTENSIONS } from "./pack.js";
import type { PlannedWrite } from "./write.js";

export interface FormatResult {
  file: string;
  changed: boolean;
  /** The canonical content to commit - present only when `changed`. */
  write?: PlannedWrite;
  /** Not Patter source (not a shard by its extension), so left alone. */
  skipped?: boolean;
  /** What else changed in it, for a person reading the output: an extension taken at a new version (the
   *  project file), or the stages renamed in its data (an extension shard). */
  notes?: string[];
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

/** The extension upgrades for each project folder named: new content by path, and the notes for each. */
function upgradesFor(paths: string[]): { content: Map<string, string>; notes: Map<string, string[]> } {
  const content = new Map<string, string>(), notes = new Map<string, string[]>();
  for (const path of paths) {
    try { if (!statSync(path).isDirectory()) continue; } catch { continue; }
    // A project that won't load is left to the canonical pass alone: format is how a broken file is
    // mended, and the upgrade waits for a project that loads.
    let loaded;
    try { loaded = loadProject(path); } catch { continue; }
    const plan = planExtensionUpgrades(loaded);
    for (const [file, text] of plan.writes) content.set(resolve(file), text);
    for (const [file, lines] of plan.notes) notes.set(resolve(file), [...(notes.get(resolve(file)) ?? []), ...lines]);
  }
  return { content, notes };
}

/** Compute the canonical form of each file. Returns planned writes; writes nothing. */
export function runFormat(paths: string[]): FormatResult[] {
  const upgrades = upgradesFor(paths);
  return paths.flatMap(expand).map((file): FormatResult => {
    if (!isShard(file)) return { file, changed: false, skipped: true };
    const original = readFileSync(file, "utf8");
    const notes = upgrades.notes.get(resolve(file));
    let canonical: string;
    try {
      canonical = upgrades.content.get(resolve(file)) ?? canonicalStringify(parseSource(original));
    } catch (e) {
      throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const changed = canonical !== original;
    return { file, changed, ...(changed ? { write: { path: file, content: canonical } } : {}), ...(notes ? { notes } : {}) };
  });
}
