// ---------------------------------------------------------------------------
// The validate op: structural + expression + interpolation validation over a
// loaded project, plus raw-bytes encoding/EOL hygiene (spec §10/§13: UTF-8
// no-BOM, LF - a BOM'd or CRLF'd file parses fine, so only a byte-level pass
// catches it before it churns diffs). Pure - returns issue lists, prints nothing.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { sidecarIssues, CONFLICT_SIDECAR } from "./merge.js";
import { validateProject, parseSource } from "@patterkit/core";
import type { ValidationIssue } from "@patterkit/core";
import { validateConditions, validateInterpolation, hostScopesToSpec, projectScopes } from "@patterkit/compiler";
import { compileLoaded, bundleOutputPath } from "./compile.js";
import type { ConditionIssue } from "@patterkit/compiler";
import type { Bundle } from "@patterkit/model";
import { PROJECT_LOCALE_SCENE } from "@patterkit/model";
import { reachabilityIssues } from "./reachability.js";
import { walkFilesByExt } from "./load.js";
import { SHARD_EXTENSIONS } from "./pack.js";
import type { LoadedProject } from "./load.js";
import { patterScopesStale, previewRegistry } from "./game-scopes.js";

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
  /** The loc shards against each other and the project: a key two shards give different text (an
   *  error: the compile refuses it), and as warnings a shard for a scene the project lacks, one in a
   *  language it does not declare, or two shards for one scene and language. */
  localisation: GameScopesIssue[];
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
  // One walk of the tree for every kind of file the checks below look for.
  const tree = walkFilesByExt(loaded.root, [...SHARD_EXTENSIONS, CONFLICT_SIDECAR, ".patterc"]);
  const localisation = locIssues(loaded);
  // ONE compile, the one export makes, inside a try: a project the compiler refuses has its cause told
  // above (a clash between loc shards, a broken condition), and must not throw out of validate.
  let compiled: Bundle | undefined;
  try { compiled = compileLoaded(loaded); } catch { compiled = undefined; }
  const staleBundles = checkBundles(loaded, compiled, tree.get(".patterc")!);
  if (compiled) gameScopes.push(...unplayableScopes(loaded, compiled));
  const unresolvedMerges = sidecarIssues(tree.get(CONFLICT_SIDECAR)!);
  const orphans = orphanShards(loaded, tree);
  // Only worth asking of a project that compiles: over a broken bundle the answer would be about the
  // breakage, and the real errors are already being told. A structural WARNING (a choice that can run
  // dry) compiles, and once switched this off, hiding real latch faults behind an advisory.
  const structuralErrors = structural.filter((i) => i.severity !== "warning");
  const reachability = compiled && structuralErrors.length === 0 && !conditions.some(isError) ? reachabilityIssues(loaded, compiled) : [];
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
    localisation,
    ok: !localisation.some(isError) && structuralErrors.length === 0 && !conditions.some(isError) && !interpolation.some(isError)
      && hygiene.length === 0 && staleBundles.length === 0 && unresolvedMerges.length === 0
      && orphans.length === 0 && !gameScopes.some(isError),
  };
}

const isError = (i: { severity: "error" | "warning" }): boolean => i.severity === "error";

/**
 * The content errors a bundle may not be built over, one line each: structural errors (not warnings),
 * condition and interpolation errors, and loc shards that disagree. Not hygiene, staleness, orphans or
 * reachability: those say nothing about whether the bundle works. `runExport` refuses on these.
 */
export function exportBlockers(loaded: LoadedProject): string[] {
  const { project, scenes, locales } = loaded;
  const merged = loaded.gameScopes?.merged;
  const foreignScopes = hostScopesToSpec(projectScopes(project, merged).host);
  const structural = validateProject({ project, scenes, authoring: loaded.authoring }).filter((i) => i.severity !== "warning");
  const conditions = validateConditions({ project, scenes }, { foreignScopes, gameScopes: merged }).filter(isError);
  const interpolation = validateInterpolation({ project, scenes, locales }, { foreignScopes, gameScopes: merged }).filter(isError);
  return [
    ...structural.map((i) => `[${i.code}] ${i.message}`),
    ...[...conditions, ...interpolation].map((i) => `[${i.field}] ${i.nodeId}: ${i.message}  (${i.src})`),
    ...locIssues(loaded).filter(isError).map((i) => `[localisation] ${i.file}: ${i.message}`),
  ];
}

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
 * Content naming another engine's scope (`@story.act`) that no game scopes folder declares: the game
 * plays it, with that engine on its registry, but `play`, coverage, and Patterpad's Play window cannot,
 * since Patter is playing alone with nothing to stand that engine in from. A warning, said here because
 * the only other place it was said was the runtime's refusal, whose advice is for a game's code.
 */
function unplayableScopes(loaded: LoadedProject, compiled: Bundle): GameScopesIssue[] {
  const registry = previewRegistry(loaded.gameScopes, compiled);
  return (compiled.externalScopes ?? []).filter((t) => !registry?.has(t)).map((t) => ({
    file: loaded.projectFile, severity: "warning" as const,
    message: `the content names @${t}, another engine's scope, and no game scopes folder declares it: the game can play it, but play, coverage, and the Play window cannot until the game shares its scopes (patter share-scopes)`,
  }));
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
export function orphanShards(loaded: LoadedProject, tree: Map<string, string[]> = walkFilesByExt(loaded.root, SHARD_EXTENSIONS)): HygieneIssue[] {
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
    for (const file of tree.get(ext) ?? []) {
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
 * - it only checks bundles that are actually present: every `.patterc` in the
 * tree, and the project's own bundle wherever it is written (`export.bundle`, or
 * the sibling `patter-dist/` default, outside the tree).
 *
 * The bundle is read with `JSON.parse`, as every runtime reads it: a bundle a
 * JSON5 reader accepts and a game's stock parser refuses is not a fresh bundle.
 */
function checkBundles(loaded: LoadedProject, compiled: Bundle | undefined, inTree: string[]): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  const own = bundleOutputPath(loaded);
  const bundles = [...new Set([...inTree, ...(existsSync(own) ? [own] : [])])];
  // The compile itself failed (a broken condition, a loc clash): its cause is reported elsewhere, so
  // staleness says nothing rather than reporting the same thing twice.
  if (bundles.length === 0 || !compiled) return issues;
  const fresh = compiled.content.hash;

  for (const file of bundles) {
    let hash: unknown;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { content?: { hash?: unknown } };
      hash = parsed?.content?.hash;
    } catch {
      issues.push({ file, message: "compiled bundle is not strict JSON, so no game can read it - run `patter export`" });
      continue;
    }
    if (hash !== fresh) {
      issues.push({ file, message: "compiled bundle is stale (does not match current source) - run `patter export`" });
    }
  }
  return issues;
}

/** The loc shards against each other and the project (see `ValidateResult.localisation`). */
function locIssues(loaded: LoadedProject): GameScopesIssue[] {
  const out: GameScopesIssue[] = [];
  const scenes = new Set([...loaded.scenes.map((sc) => sc.id), PROJECT_LOCALE_SCENE]);
  const declared = new Set(loaded.project.locales.all);
  const bySlot = new Map<string, string>();
  const byKey = new Map<string, { file: string; text: string }>();
  loaded.locales.forEach((l, i) => {
    const file = loaded.localeFiles[i] ?? "";
    if (!scenes.has(l.scene)) out.push({ file, severity: "warning", message: `strings for scene '${l.scene}', which the project does not have: nothing reads them` });
    if (!declared.has(l.locale)) out.push({ file, severity: "warning", message: `strings in '${l.locale}', which is not one of the project's languages (${[...declared].join(", ")})` });
    const slot = `${l.scene}|${l.locale}`;
    const first = bySlot.get(slot);
    if (first) out.push({ file, severity: "warning", message: `a second file of '${l.locale}' strings for scene '${l.scene}' (the first is ${first})` });
    else bySlot.set(slot, file);
    for (const [key, text] of Object.entries(l.strings)) {
      const seen = byKey.get(`${l.locale}|${key}`);
      if (!seen) { byKey.set(`${l.locale}|${key}`, { file, text }); continue; }
      if (seen.text !== text) out.push({ file, severity: "error", message: `'${key}' has different '${l.locale}' text here and in ${seen.file}; the project will not build until one is removed` });
    }
  });
  return out;
}

// Cache the per-file hygiene result by mtime: patterpad re-runs validate on every debounced keystroke, but
// the on-disk source bytes don't change between saves - so a cheap stat lets us skip re-reading every file.
// Pruned to the files of the latest call, so a project closed in Patterpad leaves nothing behind.
const hygieneCache = new Map<string, { mtimeMs: number; issues: HygieneIssue[] }>();

function checkHygiene(files: string[]): HygieneIssue[] {
  const wanted = new Set(files);
  for (const file of hygieneCache.keys()) if (!wanted.has(file)) hygieneCache.delete(file);
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
