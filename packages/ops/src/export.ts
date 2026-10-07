// ---------------------------------------------------------------------------
// The export op: compile a loaded project to the runtime bundle (spec §11).
// The compile itself, and where the bundle goes, are compile.ts's.
// ---------------------------------------------------------------------------

import type { Bundle } from "@patterkit/model";
import { walkFiles } from "./load.js";
import type { LoadedProject } from "./load.js";
import { sidecarIssues, CONFLICT_SIDECAR } from "./merge.js";
import { compileLoaded, bundleOutputPath } from "./compile.js";
import { canonicalStringify } from "@patterkit/core";
import { audioManifestWrite, scanAudio } from "./audio-index.js";
import type { AudioSnapshot } from "./audio-index.js";
import { patterScopesWrite } from "./game-scopes.js";
import type { PlannedWrite } from "./write.js";
import { exportBlockers } from "./validate.js";

/**
 * Refuse to compile a project with a merge still unresolved (patter-merge.md §3.6, via
 * `sidecarIssues`). A merged shard is valid canonical source whose conflicted values resolved
 * provisionally to OURS, so a bundle built over one is a bundle of one side of a disagreement.
 * `validate` has always said so; export never looked, and an author who runs `patter export`
 * without validating first is exactly the person the rule is for.
 */
function refuseUnresolvedMerge(loaded: LoadedProject): void {
  const issues = sidecarIssues(walkFiles(loaded.root, CONFLICT_SIDECAR));
  if (!issues.length) return;
  throw new Error(
    `${issues.length} unresolved merge conflict(s) - resolve them and delete the .patterconflict sidecar(s) first:\n` +
    issues.map((i) => `  ${i.file}`).join("\n"),
  );
}

/** What a shipped build may not be built over. */
export interface ExportOptions {
  /** Build even when validate finds errors in the content (a dangling jump, a condition that does not
   *  parse): the CLI's `--allow-invalid`. Never what a game wants; for looking at a broken build. */
  allowInvalid?: boolean;
}

/**
 * Refuse to build a bundle validate calls broken (CLI review 2026-10, ruling A). It compiled, and the game
 * then failed on it: `play` stops at the dangling jump, and Patterpad's Auto Rebuild, which keeps the last
 * good build when export throws, wrote the broken one over it and pushed it to the running game.
 */
function refuseInvalid(loaded: LoadedProject, opts: ExportOptions): void {
  if (opts.allowInvalid) return;
  const blockers = exportBlockers(loaded);
  if (!blockers.length) return;
  const shown = blockers.slice(0, 10).map((b) => `  ${b}`);
  if (blockers.length > shown.length) shown.push(`  ... and ${blockers.length - shown.length} more (patter validate lists them)`);
  throw new Error(`${blockers.length} problem(s) to fix before this project builds:\n${shown.join("\n")}`);
}

/** Compile a loaded project to the runtime bundle, applying its build localisation mode (spec §11):
 *  "embedded" (default) keeps every locale's strings inline; "ids" strips them so the runtime emits beat
 *  IDs (the game localises). `sourceDebug` keeps only the SOURCE locale, embedded for debug playback and
 *  flagged so the runtime warns it is not a shippable build. Refuses an unresolved merge, and content
 *  validate calls broken unless `allowInvalid`. */
export function runExport(loaded: LoadedProject, opts: ExportOptions = {}): Bundle {
  refuseUnresolvedMerge(loaded);
  refuseInvalid(loaded, opts);
  const { project } = loaded;
  const full = compileLoaded(loaded);
  const loc = project.export?.localisation;
  if (!loc || loc.mode === "embedded") return full;
  // "ids": drop all strings (sourceDebug keeps the source locale for debugging only).
  const strings = loc.sourceDebug ? { [full.locales.default]: full.strings[full.locales.default] ?? {} } : {};
  return { ...full, strings, localisation: { mode: "ids", ...(loc.sourceDebug ? { sourceDebug: true } : {}) } };
}

/** Compile WITHOUT the localisation-mode transform - the full bundle with every locale inline. Used where
 *  the host needs all strings regardless of build mode (e.g. Patterpad's Play window + Export Localisation).
 *  Refuses an unresolved merge; broken content only with `refuseInvalid: true` (the playable page), since
 *  the Play window exists to try content mid-edit. */
export function runExportFull(loaded: LoadedProject, opts: ExportOptions & { refuseInvalid?: boolean } = {}): Bundle {
  refuseUnresolvedMerge(loaded);
  if (opts.refuseInvalid) refuseInvalid(loaded, opts);
  return compileLoaded(loaded);
}

/** Everything a build writes, for a front end to commit. */
export interface BuildPlan {
  bundle: Bundle;
  /** The bundle as written: strict JSON, since every runtime reads it with a stock parser. */
  text: string;
  /** The bundle, `patter.scopes.json` when the game's scopes folder needs it brought up to date, and the
   *  audio manifest when the project uses Audio Folders and has takes. The bundle first. */
  writes: PlannedWrite[];
}

/**
 * Plan a build: the bundle and everything that goes with it, so every front end writes the same set
 * (CLI review 2026-10, item 23). Patterpad's Build wrote bundle, scopes and audio manifest; its Auto
 * Rebuild skipped the scopes file; `patter export` never wrote the manifest. `bundlePath` overrides
 * where the bundle goes (the CLI's `-o`); `audio` is a snapshot the caller already holds (Patterpad's
 * live index), else the folders are scanned now.
 */
export function planBuild(loaded: LoadedProject, opts: ExportOptions & { bundlePath?: string; audio?: AudioSnapshot } = {}): BuildPlan {
  const bundle = runExport(loaded, opts);
  const text = canonicalStringify(bundle, { trailingComma: false });
  const scopes = patterScopesWrite(loaded.project, loaded.gameScopes);
  const audio = audioManifestWrite(loaded, opts.audio ?? scanAudio(loaded));
  return {
    bundle,
    text,
    writes: [{ path: opts.bundlePath ?? bundleOutputPath(loaded), content: text }, ...(scopes ? [scopes] : []), ...(audio ? [audio] : [])],
  };
}
