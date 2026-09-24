// ---------------------------------------------------------------------------
// The validate op: structural + expression + interpolation validation over a
// loaded project, plus raw-bytes encoding/EOL hygiene (spec §10/§13: UTF-8
// no-BOM, LF - a BOM'd or CRLF'd file parses fine, so only a byte-level pass
// catches it before it churns diffs). Pure - returns issue lists, prints nothing.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { sidecarIssues, CONFLICT_SIDECAR } from "./merge.js";
import { validateProject, parseSource } from "@patterkit/core";
import type { ValidationIssue } from "@patterkit/core";
import { validateConditions, validateInterpolation, exportBundle, hostScopesToSpec, projectScopes } from "@patterkit/compiler";
import type { ConditionIssue } from "@patterkit/compiler";
import { reachabilityIssues } from "./reachability.js";
import { walkFiles } from "./load.js";
import type { LoadedProject } from "./load.js";
import { patterScopesStale } from "./game-scopes.js";

/** A raw-bytes hygiene problem in one source file (repairable by `format`). */
export interface HygieneIssue {
  file: string;
  message: string;
}

/** A problem with the game's shared scopes folder, or between it and the project, anchored to a file. */
export interface GameScopesIssue {
  file: string;
  message: string;
  /** "error" (a scopes file that won't parse, a token two files claim, an override that names no folder)
   *  blocks a clean build; "warning" (Patter's file out of date, the project's copy of a game scope
   *  differing from the shared file) does not. */
  severity: "error" | "warning";
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
  /** Conditions provably unsatisfiable over monotonic latches (reachability.ts). WARNINGS, and
   *  deliberately NOT part of `ok`: content is written in pieces, so a gate whose writer has not been
   *  authored yet is the normal state mid-work and must never fail a build. */
  reachability: ConditionIssue[];
  /** Lingering `.patterconflict` sidecars - an unresolved merge (patter-merge.md §3.6). */
  unresolvedMerges: HygieneIssue[];
  /** Patter shards on disk that the project does NOT contain - see `orphanShards`. */
  orphans: HygieneIssue[];
  /** The game's shared scopes folder: its files, and how the project stands against them. Only the
   *  errors count against `ok`. Empty when the project has no folder. */
  gameScopes: GameScopesIssue[];
  /** Only ERRORS count: a warning (another tool's scope, say) never fails a build. */
  ok: boolean;
}

/** Run structural + expression + interpolation + hygiene + bundle-staleness + merge validation. */
export function runValidate(loaded: LoadedProject): ValidateResult {
  const { project, scenes, locales } = loaded;
  const structural = validateProject({ project, scenes, authoring: loaded.authoring });
  // The project's own host scopes (`@world`, ...) are foreign to Patter's owned schema but first-class to
  // the project: pass them so references into them validate (and read-only writes are flagged). With a
  // game scopes folder, they are as the folder leaves them, and every other scope in it is checked too,
  // with warnings.
  const merged = loaded.gameScopes?.merged;
  const scopes = projectScopes(project, merged);
  const foreignScopes = hostScopesToSpec(scopes.host);
  const conditions = validateConditions({ project, scenes }, { foreignScopes, gameScopes: merged });
  const interpolation = validateInterpolation({ project, scenes, locales }, { foreignScopes, gameScopes: merged });
  const gameScopes = gameScopesIssues(loaded, scopes.notes);
  const hygiene = checkHygiene([loaded.projectFile, ...Object.values(loaded.sceneFiles), ...loaded.localeFiles, ...loaded.authoringFiles]);
  const staleBundles = checkBundles(loaded);
  const unresolvedMerges = sidecarIssues(walkFiles(loaded.root, CONFLICT_SIDECAR));
  const orphans = orphanShards(loaded);
  // Only worth asking of a project that compiles: over a broken bundle the answer would be about the
  // breakage, and the real errors are already being told.
  const reachability = structural.length === 0 && !conditions.some(isError) ? reachabilityIssues(loaded) : [];
  return {
    structural,
    conditions,
    interpolation,
    reachability,
    hygiene,
    staleBundles,
    unresolvedMerges,
    orphans,
    gameScopes,
    ok: structural.length === 0 && !conditions.some(isError) && !interpolation.some(isError)
      && hygiene.length === 0 && staleBundles.length === 0 && unresolvedMerges.length === 0
      && orphans.length === 0 && !gameScopes.some(isError),
  };
}

const isError = (i: { severity: "error" | "warning" }): boolean => i.severity === "error";

/**
 * The game scopes folder's own problems (a file that won't parse, a token two files claim), an override
 * naming a folder that isn't there, Patter's file out of date, and where the project's host scopes and
 * the folder disagree. Nothing at all for a project with no folder.
 */
function gameScopesIssues(loaded: LoadedProject, notes: { file: string; message: string }[]): GameScopesIssue[] {
  const out: GameScopesIssue[] = [];
  if (loaded.gameScopesMissing) out.push({ file: loaded.projectFile, severity: "error", message: loaded.gameScopesMissing });
  const gs = loaded.gameScopes;
  if (!gs) return out;
  for (const i of gs.issues) out.push({ file: i.file, severity: i.severity, message: i.message });
  for (const n of notes) out.push({ file: join(gs.dir, n.file), severity: "warning", message: n.message });
  const stale = patterScopesStale(loaded.project, gs);
  if (stale) out.push({ ...stale, severity: "warning" });
  return out;
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
  // Decided from PATHS, not from what happens to be in memory. This first compared the disk walk with
  // the loaded file lists, which is only right while those lists track every file: a shard that
  // appeared under its folder after the project was opened (another tool, a checkout, a colleague's
  // sync) was reported as outside the project while sitting exactly where the loader reads from
  // (the Hamlet demo, 2026-09-03). The loader collects by folder, so the folder is the rule.
  // The message names the file, relative to the project, and the folder this project reads that kind
  // from: "this file" with no file was the one thing a reader could not act on.
  const layout = { flow: "scenes/", strings: "loc/", authoring: "authoring/", ...loaded.project.layout };
  const kind: Record<string, { what: string; home: string | null }> = {
    ".patterflow": { what: "scene", home: layout.flow },
    ".patterloc": { what: "strings", home: layout.strings },
    ".patterx": { what: "authoring", home: layout.authoring },
    ".patterproj": { what: "project", home: null },
  };
  const inside = (file: string, dir: string): boolean => {
    const r = relative(dir, file);
    return r !== "" && !r.startsWith("..") && !isAbsolute(r);
  };
  const out: HygieneIssue[] = [];
  for (const [ext, { what, home }] of Object.entries(kind)) {
    for (const file of walkFiles(loaded.root, ext)) {
      if (home ? inside(file, join(loaded.root, home)) : file === loaded.projectFile) continue;
      const rel = relative(loaded.root, file);
      const message = home
        ? `${rel} is a ${what} file outside the project's folders: nothing loads it, so none of it is in the project. Move it under ${home}, or delete it.`
        : `${rel} is a second project file: only ${basename(loaded.projectFile)} is read. Delete it, or move it out of the project.`;
      out.push({ file, message });
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
    fresh = exportBundle({ project: loaded.project, scenes: loaded.scenes, locales: loaded.locales, gameScopes: loaded.gameScopes?.merged }).content.hash;
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
