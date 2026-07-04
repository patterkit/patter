// ---------------------------------------------------------------------------
// The format op: compute the canonical form of source files (spec §10).
//
// Pure: never writes - each changed file comes back as a planned write for the
// caller to commit (CLI `format`), check (CI `format --check`), or preview
// (Patterpad). Parse failures throw.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { canonicalStringify, parseSource } from "@patterkit/core";
import type { PlannedWrite } from "./write.js";

export interface FormatResult {
  file: string;
  changed: boolean;
  /** The canonical content to commit - present only when `changed`. */
  write?: PlannedWrite;
}

/** Compute the canonical form of each file. Returns planned writes; writes nothing. */
export function runFormat(files: string[]): FormatResult[] {
  return files.map((file) => {
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
