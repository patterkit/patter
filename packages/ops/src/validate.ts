// ---------------------------------------------------------------------------
// The validate op: structural + expression + interpolation validation over a
// loaded project, plus raw-bytes encoding/EOL hygiene (spec §10/§13: UTF-8
// no-BOM, LF - a BOM'd or CRLF'd file parses fine, so only a byte-level pass
// catches it before it churns diffs). Pure - returns issue lists, prints nothing.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";
import { sidecarIssues, CONFLICT_SIDECAR } from "./merge.js";
import { validateProject, parseSource } from "@patterkit/core";
import type { ValidationIssue } from "@patterkit/core";
import { validateConditions, validateInterpolation, exportBundle, hostScopesToSpec } from "@patterkit/compiler";
import type { ConditionIssue } from "@patterkit/compiler";
import { walkFiles } from "./load.js";
import type { LoadedProject } from "./load.js";

/** A raw-bytes hygiene problem in one source file (repairable by `format`). */
export interface HygieneIssue {
  file: string;
  message: string;
}

export interface ValidateResult {
  structural: ValidationIssue[];
  conditions: ConditionIssue[];
  /** Inline `{@ref}` interpolation issues (voiced-line slots, unknown/malformed refs). */
  interpolation: ConditionIssue[];
  /** Encoding/EOL hygiene (BOM, CRLF) - spec §10. */
  hygiene: HygieneIssue[];
  /** Committed `.patterc` bundles whose hash no longer matches source (spec §11). */
  staleBundles: HygieneIssue[];
  /** Lingering `.patterconflict` sidecars - an unresolved merge (patter-merge.md §3.6). */
  unresolvedMerges: HygieneIssue[];
  /** Patter shards on disk that the project does NOT contain - see `orphanShards`. */
  orphans: HygieneIssue[];
  ok: boolean;
}

/** Run structural + expression + interpolation + hygiene + bundle-staleness + merge validation. */
export function runValidate(loaded: LoadedProject): ValidateResult {
  const { project, scenes, locales } = loaded;
  const structural = validateProject({ project, scenes, authoring: loaded.authoring });
  // The project's own host scopes (`@world`, ...) are foreign to Patter's owned schema but first-class to
  // the project: pass them so references into them validate (and read-only writes are flagged).
  const foreignScopes = hostScopesToSpec(project.scopeRegistry);
  const conditions = validateConditions({ project, scenes }, { foreignScopes });
  const interpolation = validateInterpolation({ project, scenes, locales }, { foreignScopes });
  const hygiene = checkHygiene([loaded.projectFile, ...Object.values(loaded.sceneFiles), ...loaded.localeFiles, ...loaded.authoringFiles]);
  const staleBundles = checkBundles(loaded);
  const unresolvedMerges = sidecarIssues(walkFiles(loaded.root, CONFLICT_SIDECAR));
  const orphans = orphanShards(loaded);
  return {
    structural,
    conditions,
    interpolation,
    hygiene,
    staleBundles,
    unresolvedMerges,
    orphans,
    ok: structural.length === 0 && conditions.length === 0 && interpolation.length === 0
      && hygiene.length === 0 && staleBundles.length === 0 && unresolvedMerges.length === 0
      && orphans.length === 0,
  };
}

/**
 * Patter source files that are NOT part of the project.
 *
 * The loader is strict about every file it READS - a bad parse, a wrong shape, two files claiming one
 * scene id all throw, naming the file - but it collects by layout directory, so a perfectly valid
 * `.patterflow` outside `scenes/` is not malformed. It is simply not in the project, and until now
 * nothing anywhere said so: not the loader, which never looked at it, and not validate, which
 * examined only what loaded. A scene moved by hand, dropped in the root, or left behind by a
 * reorganisation just stopped existing (from-storylets/load-issues-and-the-strict-loader).
 *
 * This is the cheap half of a warnings channel: strictness stays, and the one state it cannot see
 * becomes a question the author can answer.
 */
export function orphanShards(loaded: LoadedProject): HygieneIssue[] {
  const collected = new Set([
    loaded.projectFile,
    ...Object.values(loaded.sceneFiles),
    ...loaded.localeFiles,
    ...loaded.authoringFiles,
  ]);
  const kind: Record<string, string> = {
    ".patterflow": "scene", ".patterloc": "locale", ".patterx": "authoring", ".patterproj": "project",
  };
  const out: HygieneIssue[] = [];
  for (const [ext, what] of Object.entries(kind)) {
    for (const file of walkFiles(loaded.root, ext)) {
      if (collected.has(file)) continue;
      out.push({ file, message: `a ${what} shard outside the project's layout - nothing loads it, so its content is not in the project (move it under the configured folder, or delete it)` });
    }
  }
  return out;
}

/**
 * The bundle staleness gate (spec §11): a committed `.patterc` carries a content
 * hash of its source inputs; if it no longer matches a fresh compile of the
 * committed source, the bundle is stale and must be regenerated. This is what
 * makes a committed-and-`merge=ours` bundle safe after a merge. Posture-agnostic
 * - it only checks bundles that are actually present in the tree.
 */
function checkBundles(loaded: LoadedProject): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  const bundles = walkFiles(loaded.root, ".patterc");
  if (bundles.length === 0) return issues;

  let fresh: unknown;
  try {
    fresh = exportBundle({ project: loaded.project, scenes: loaded.scenes, locales: loaded.locales }).content.hash;
  } catch {
    // The compile itself failed (e.g. a broken condition); validateConditions
    // already reports the cause - don't double-report by failing staleness too.
    return issues;
  }

  for (const file of bundles) {
    let hash: unknown;
    try {
      const parsed = parseSource(readFileSync(file, "utf8")) as { content?: { hash?: unknown } };
      hash = parsed?.content?.hash;
    } catch {
      issues.push({ file, message: "compiled bundle is unparseable - run `patter export`" });
      continue;
    }
    if (hash !== fresh) {
      issues.push({ file, message: "compiled bundle is stale (does not match current source) - run `patter export`" });
    }
  }
  return issues;
}

// Cache the per-file hygiene result by mtime: patterpad re-runs validate on every debounced keystroke, but
// the on-disk source bytes don't change between saves - so a cheap stat lets us skip re-reading every file.
const hygieneCache = new Map<string, { mtimeMs: number; issues: HygieneIssue[] }>();

function checkHygiene(files: string[]): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  for (const file of files) {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      continue; // unreadable files surface via the loader, not here
    }
    const hit = hygieneCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) { issues.push(...hit.issues); continue; }
    const fileIssues: HygieneIssue[] = [];
    try {
      const text = readFileSync(file, "utf8");
      if (text.charCodeAt(0) === 0xfeff) {
        fileIssues.push({ file, message: "file starts with a UTF-8 BOM (canonical form is UTF-8 without BOM - run `patter format`)" });
      }
      if (text.includes("\r")) {
        fileIssues.push({ file, message: "file contains CRLF line endings (canonical form is LF - run `patter format`)" });
      }
    } catch {
      continue;
    }
    hygieneCache.set(file, { mtimeMs, issues: fileIssues });
    issues.push(...fileIssues);
  }
  return issues;
}
