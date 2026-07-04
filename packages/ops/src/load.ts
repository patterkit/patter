// ---------------------------------------------------------------------------
// Project loader - discover and read a Patter project from disk.
//
// Discovery walks up from a start path for a `*.patterproj`, then reads scene
// (`.patter`) and locale (`.patterloc`) files from the layout dirs (project
// `layout`, with conventional defaults). Pure filesystem reads (spec §13/§14).
//
// Hand-edited JSON5 is a supported path, so every failure names the FILE: a
// parse error, a file of the wrong shape, or two files claiming the same scene
// id all throw with the offending path(s) - never a bare SyntaxError or a
// TypeError from deep inside a consumer.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { parseSource } from "@patterkit/core";
import type { ProjectFile, FlowFile, LocaleFile, AuthoringFile, Scene } from "@patterkit/model";

export interface LoadedProject {
  root: string;
  projectFile: string;
  project: ProjectFile;
  scenes: Scene[];
  locales: LocaleFile[];
  /** Source file for each scene (scene id -> absolute path) - "where it lives". */
  sceneFiles: Record<string, string>;
  /** Source file of each entry in `locales`, index-aligned. */
  localeFiles: string[];
  /** Authoring metadata shards (comments / statuses / estimates - spec section 5 schema). */
  authoring: AuthoringFile[];
  /** Source file of each entry in `authoring`, index-aligned. */
  authoringFiles: string[];
}

function readDirSafe(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Recursively collect files under `dir` whose name ends exactly with `ext`. */
export function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readDirSafe(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, ext));
    else if (e.isFile() && e.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

/**
 * Find the nearest `*.patterproj` at or above `startPath` - one readdir per
 * level (never a recursive scan of ancestors). Throws if none is found, or if
 * a directory holds more than one (ambiguous - the alphabetically-first would
 * silently win).
 */
export function findProjectFile(startPath: string): string {
  let dir = resolve(startPath);
  try {
    if (statSync(dir).isFile()) {
      if (dir.endsWith(".patterproj")) return dir;
      dir = dirname(dir);
    }
  } catch {
    // startPath may not exist; treat as a directory path and walk up anyway.
  }
  for (;;) {
    const here = readDirSafe(dir)
      .filter((e) => e.isFile() && e.name.endsWith(".patterproj"))
      .map((e) => join(dir, e.name))
      .sort();
    if (here.length > 1) throw new Error(`multiple project files in ${dir}: ${here.map((p) => p.slice(dir.length + 1)).join(", ")}`);
    if (here.length === 1) return here[0]!;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no .patterproj found at or above ${startPath}`);
    dir = parent;
  }
}

/** Parse one source file, attaching the path to any failure. */
function parseFile<T>(file: string, expectSchema: string, shapeKey: string): T {
  let parsed: unknown;
  try {
    parsed = parseSource(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const obj = parsed as Record<string, unknown> | null;
  if (typeof obj !== "object" || obj === null || !(shapeKey in obj)) {
    throw new Error(`${file}: not a ${expectSchema} file (missing '${shapeKey}')`);
  }
  const schema = obj["schema"];
  if (typeof schema !== "string" || !schema.startsWith(expectSchema)) {
    throw new Error(`${file}: schema is '${String(schema)}', expected '${expectSchema}@...'`);
  }
  migrateLegacyPropertyTypes(parsed, expectSchema);
  return parsed as T;
}

/** Back-compat (#209): older files spelled the boolean property type `"bool"`; the format now uses
 *  `"boolean"` (matching `@wildwinter/expr`, dropping a conversion). Normalise it on read so existing
 *  projects keep loading - they upgrade to `"boolean"` on the next save. Touches only PropertyDecl /
 *  HostScopeDecl `type` fields (`@patter` properties, `@scene` props, host-scope declarations). */
function migrateLegacyPropertyTypes(parsed: unknown, expectSchema: string): void {
  const fixDecls = (decls: unknown): void => {
    if (!Array.isArray(decls)) return;
    for (const d of decls) {
      if (d && typeof d === "object" && (d as { type?: unknown }).type === "bool") (d as { type: string }).type = "boolean";
    }
  };
  if (!parsed || typeof parsed !== "object") return;
  const obj = parsed as Record<string, unknown>;
  if (expectSchema === "patter/project") {
    fixDecls(obj["properties"]);
    const reg = obj["scopeRegistry"] as { scopes?: unknown } | undefined;
    if (reg && Array.isArray(reg.scopes)) for (const s of reg.scopes) fixDecls((s as { declarations?: unknown }).declarations);
    // Back-compat (#206): recordingStatuses was a flat `string[]`; it now carries a colour, so each rung is
    // a `{ name }` decl. Lift any legacy string entries on read; they upgrade on the next save.
    const recs = obj["recordingStatuses"];
    if (Array.isArray(recs)) obj["recordingStatuses"] = recs.map((r) => (typeof r === "string" ? { name: r } : r));
  } else if (expectSchema === "patter/flow") {
    const scene = obj["scene"] as { sceneProps?: unknown } | undefined;
    fixDecls(scene?.sceneProps);
  }
}

/**
 * The scene id a shard path belongs to, for a file-association launch (Finder / argv onto a scene's flow
 * / loc / authoring file): a flow file declares its scene, a loc file names its scene, an authoring shard
 * mirrors the flow stem. Returns undefined for the project root / manifest / any non-scene path (so the
 * caller lands on the remembered scene instead). Cheap - parses at most the one shard (and, for an
 * authoring shard, its sibling flow file).
 */
export function sceneIdForShard(shardPath: string): string | undefined {
  const p = resolve(shardPath);
  try {
    if (p.endsWith(".patterflow")) return (parseSource(readFileSync(p, "utf8")) as FlowFile).scene?.id;
    if (p.endsWith(".patterloc")) return (parseSource(readFileSync(p, "utf8")) as LocaleFile).scene;
    if (p.endsWith(".patterx")) {
      const projectFile = findProjectFile(p);
      const project = parseFile<ProjectFile>(projectFile, "patter/project", "project");
      const flowDir = join(dirname(projectFile), project.layout?.flow ?? "scenes/");
      const flowPath = join(flowDir, basename(p).replace(/\.patterx$/, ".patterflow"));
      return (parseSource(readFileSync(flowPath, "utf8")) as FlowFile).scene?.id;
    }
  } catch { /* unreadable / wrong shape / no enclosing project -> not a resolvable scene shard */ }
  return undefined;
}

/**
 * Phase-1 "landing" load (Patterpad's lazy open): parse the manifest and ONLY the landing scene's shards
 * (its flow file + its source-language loc), leaving the rest of the project unparsed. The result is a
 * partial `LoadedProject` whose `scenes` / `locales` hold just the landing scene, so the editor can paint
 * it immediately; `loadProject` (the full eager parse) hydrates the rest in phase 2.
 *
 * The landing scene is the one named by `launchPath` (a file-association open onto a scene shard), else
 * `preferId` (the remembered scene), else the first scene file. `authoring` is left empty - it is read
 * lazily per scene from disk (project.ts), never from this array.
 */
export function loadProjectLanding(startPath: string, opts?: { launchPath?: string; preferId?: string }): LoadedProject {
  const projectFile = findProjectFile(startPath);
  const root = dirname(projectFile);
  const project = parseFile<ProjectFile>(projectFile, "patter/project", "project");
  const layout = { flow: "scenes/", strings: "loc/", authoring: "authoring/", ...project.layout };

  const flowFiles = walkFiles(join(root, layout.flow), ".patterflow");
  const launchPath = opts?.launchPath ? resolve(opts.launchPath) : undefined;

  // Resolve the landing flow file: a launch directly onto a flow shard is the exact file; otherwise find
  // the file declaring the target scene (parsing files until matched); failing that, the first scene file.
  let landingFile: string | undefined;
  if (launchPath?.endsWith(".patterflow")) landingFile = flowFiles.find((f) => resolve(f) === launchPath);
  if (!landingFile) {
    const targetId = (opts?.launchPath ? sceneIdForShard(opts.launchPath) : undefined) ?? opts?.preferId;
    if (targetId) {
      for (const f of flowFiles) {
        if (parseFile<FlowFile>(f, "patter/flow", "scene").scene.id === targetId) { landingFile = f; break; }
      }
    }
  }
  landingFile ??= flowFiles[0];
  const landingScene = landingFile ? parseFile<FlowFile>(landingFile, "patter/flow", "scene").scene : undefined;

  const scenes: Scene[] = [];
  const sceneFiles: Record<string, string> = {};
  if (landingScene && landingFile) { scenes.push(landingScene); sceneFiles[landingScene.id] = landingFile; }

  // The landing scene's source-language locale shard (Patterpad edits only the default locale). Try the
  // conventional path `loc/<default>/<flow-stem>.patterloc` first so a large project's other loc files stay
  // unparsed in phase 1; fall back to scanning the loc dir for a hand-arranged layout.
  const locales: LocaleFile[] = [];
  const localeFiles: string[] = [];
  if (landingScene && landingFile) {
    const defaultLocale = project.locales.default;
    const strings = join(root, layout.strings);
    const guess = join(strings, defaultLocale, `${basename(landingFile).replace(/\.patterflow$/, "")}.patterloc`);
    let found = false;
    if (existsSync(guess)) {
      try {
        const loc = parseFile<LocaleFile>(guess, "patter/strings", "strings");
        if (loc.scene === landingScene.id) { locales.push(loc); localeFiles.push(guess); found = true; }
      } catch { /* not the conventional file after all -> fall through to the scan */ }
    }
    if (!found) {
      for (const f of walkFiles(strings, ".patterloc")) {
        const loc = parseFile<LocaleFile>(f, "patter/strings", "strings");
        if (loc.scene !== landingScene.id) continue;
        locales.push(loc); localeFiles.push(f);
        if (loc.locale === defaultLocale || loc.default) break; // got the source-language shard; stop scanning
      }
    }
  }

  return { root, projectFile, project, scenes, locales, sceneFiles, localeFiles, authoring: [], authoringFiles: [] };
}

/** Sort scenes into the project's authored nav order (`ProjectFile.sceneOrder`), in place.
 *  Listed scenes come first in list order; unlisted scenes follow in their existing (file) order;
 *  listed ids that no longer exist are simply ignored. Presentation only - play order is untouched. */
export function applySceneOrder(scenes: Scene[], order: string[] | undefined): void {
  if (!order?.length) return;
  const rank = new Map(order.map((id, i) => [id, i]));
  const fileRank = new Map(scenes.map((s, i) => [s.id, i]));
  scenes.sort((a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return (fileRank.get(a.id) ?? 0) - (fileRank.get(b.id) ?? 0);
  });
}

export function loadProject(startPath: string): LoadedProject {
  const projectFile = findProjectFile(startPath);
  const root = dirname(projectFile);
  const project = parseFile<ProjectFile>(projectFile, "patter/project", "project");

  const layout = { flow: "scenes/", strings: "loc/", authoring: "authoring/", ...project.layout };

  const scenes: Scene[] = [];
  const sceneFiles: Record<string, string> = {};
  for (const f of walkFiles(join(root, layout.flow), ".patterflow")) {
    const scene = parseFile<FlowFile>(f, "patter/flow", "scene").scene;
    const existing = sceneFiles[scene.id];
    if (existing !== undefined) {
      // Last-wins here would silently drop a scene from the exported bundle.
      throw new Error(`scene id '${scene.id}' is declared by two files: ${existing} and ${f}`);
    }
    scenes.push(scene);
    sceneFiles[scene.id] = f;
  }
  applySceneOrder(scenes, project.sceneOrder);

  const locales: LocaleFile[] = [];
  const localeFiles: string[] = [];
  for (const f of walkFiles(join(root, layout.strings), ".patterloc")) {
    locales.push(parseFile<LocaleFile>(f, "patter/strings", "strings"));
    localeFiles.push(f);
  }

  const authoring: AuthoringFile[] = [];
  const authoringFiles: string[] = [];
  for (const f of walkFiles(join(root, layout.authoring), ".patterx")) {
    authoring.push(parseFile<AuthoringFile>(f, "patter/authoring", "schema"));
    authoringFiles.push(f);
  }

  return { root, projectFile, project, scenes, locales, sceneFiles, localeFiles, authoring, authoringFiles };
}
