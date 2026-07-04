// ---------------------------------------------------------------------------
// Planned writes - the contract for ops that change files (spec §13).
//
// An op never writes the filesystem itself; it RETURNS the writes it wants, and
// the caller commits them. This one seam buys: `--check` / dry-run in the CLI
// for free, preview-before-apply + undo in Patterpad, and a place for the
// editor to route writes through VCS checkout (`p4 edit` before save).
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One file write an op wants performed. `content` is full canonical file text. */
export interface PlannedWrite {
  path: string;
  content: string;
}

/**
 * Commit planned writes to disk (UTF-8), creating parent directories. The PLAIN
 * filesystem applier - for tests and no-VCS embedders only; product code (the
 * CLI, Patterpad) routes through @patterkit/vcs so writes land correctly in a
 * Perforce / locked workspace (spec §12).
 */
export function applyWrites(writes: PlannedWrite[]): void {
  for (const w of writes) {
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.content, "utf8");
  }
}
