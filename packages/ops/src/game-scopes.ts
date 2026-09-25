// ---------------------------------------------------------------------------
// Shared game scopes, the file side (patterkit/design/shared-scopes.md).
//
// A game keeps one `game-scopes/` folder. Patter writes `patter.scopes.json` there (the project's
// shared `@patter` properties: per-flow globals are not game-wide), the game keeps `game.scopes.json`
// (the scopes it provides, `@world` among them), and every other tool writes its own file. The pure
// work (parsing, the canonical text, the walk-up, the merge) is `@wildwinter/scoperegistry/scopes`;
// this module is Patter's file access around it. With no folder, nothing here does anything, and the
// project works alone exactly as it did.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  findGameScopes, mergeScopes, parseScopesFile, scopesCatalogue, serialiseScopesFile, standInRegistry,
  GAME_SCOPES_DIR, GAME_SCOPES_FILE, SCOPES_FILE_SUFFIX,
} from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes, NamedScopesFile, ScopesCatalogueEntry, ScopesFile, ScopesFs, ScopesIssue } from "@wildwinter/scoperegistry/scopes";
import type { ScopeDeclaration, ScopeRegistry, ScopeSpec } from "@wildwinter/scoperegistry";
import { canonicalStringify } from "@patterkit/core";
import { PATTER_SCOPE, EXTERNAL_SCOPES } from "@patterkit/compiler";
import type { Bundle, HostScopeRegistry, HostScopeSpec, ProjectFile } from "@patterkit/model";
import type { PlannedWrite } from "./write.js";

/** Patter's own file in the folder. */
export const PATTER_SCOPES_FILE = `${PATTER_SCOPE}${SCOPES_FILE_SUFFIX}`;
/** Who Patter's file says wrote it. */
export const PATTER_SCOPES_OWNER = "Patter";
/** Who the game's own file says wrote it, when Patter is the first to create it. */
export const GAME_SCOPES_OWNER = "Game";

/** A project's game scopes folder, read and merged. */
export interface GameScopes {
  /** The folder, absolute. */
  dir: string;
  /** Every scopes file in it that parsed, by name. */
  files: NamedScopesFile[];
  /** The whole folder as one spec, with who declares each token. */
  merged: MergedScopes;
  /** Files that would not parse and tokens two files claim, each naming its file (absolute). */
  issues: ScopesIssue[];
  /** The text of `patter.scopes.json` as it was read, or undefined when there is none yet. */
  patterText?: string;
}

/** Node's file system, as discovery wants it. `join` resolves, so a relative override lands right. */
const nodeFs: ScopesFs = {
  exists: (p) => existsSync(p),
  parent: (p) => dirname(p),
  join: (dir, name) => resolve(dir, name),
};

/** Read and merge every `*.scopes.json` in a game scopes folder. */
export function readGameScopes(dir: string): GameScopes {
  const files: NamedScopesFile[] = [];
  const issues: ScopesIssue[] = [];
  let patterText: string | undefined;
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(SCOPES_FILE_SUFFIX)).sort(); } catch { /* an unreadable folder reads as empty */ }
  for (const name of names) {
    const path = join(dir, name);
    let text: string;
    try { text = readFileSync(path, "utf8"); } catch (e) {
      issues.push({ severity: "error", file: path, message: `cannot read it: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (name === PATTER_SCOPES_FILE) patterText = text;
    const parsed = parseScopesFile(text, name);
    for (const i of parsed.issues) issues.push({ ...i, file: path });
    if (parsed.file) files.push({ fileName: name, file: parsed.file });
  }
  const merged = mergeScopes(files);
  for (const i of merged.issues) issues.push({ ...i, file: join(dir, i.file) });
  return { dir, files, merged, issues, ...(patterText !== undefined ? { patterText } : {}) };
}

/**
 * Find and read a project's game scopes: the project's `gameScopes` override (relative to the project
 * file's folder), else the walk-up from that folder. `missing` is the error for an override naming a
 * folder that doesn't exist; no folder at all is not an error.
 */
export function discoverGameScopes(root: string, project: ProjectFile): { gameScopes?: GameScopes; missing?: string } {
  const found = findGameScopes(root, nodeFs, project.gameScopes !== undefined ? { override: project.gameScopes } : {});
  if (found.issue) return { missing: found.issue };
  return found.dir ? { gameScopes: readGameScopes(found.dir) } : {};
}

/**
 * The game's scopes files as a pack carries them (patterkit/design/shared-scopes.md, "Packs"): every
 * `*.scopes.json` in the folder the loader would find, by name, as its text on disk, sorted by name.
 * Empty when there is no folder (or the project names one that isn't there), so a pack is as it was.
 * A file that won't parse travels too: the snapshot is the folder as it is, not as Patter reads it.
 */
export function gameScopesSnapshot(root: string, project: ProjectFile): Array<{ fileName: string; text: string }> {
  const found = findGameScopes(root, nodeFs, project.gameScopes !== undefined ? { override: project.gameScopes } : {});
  if (!found.dir) return [];
  let names: string[] = [];
  try { names = readdirSync(found.dir).filter((n) => n.endsWith(SCOPES_FILE_SUFFIX)).sort(); } catch { /* an unreadable folder packs as none */ }
  return names.map((fileName) => ({ fileName, text: readFileSync(join(found.dir!, fileName), "utf8") }));
}

/** Patter's scopes file for a project: its shared `@patter` properties, in declaration order. */
export function patterScopesFile(project: ProjectFile): ScopesFile {
  const declarations: ScopeDeclaration[] = (project.properties ?? [])
    .filter((p) => p.shared ?? true)
    .map((p) => ({
      name: p.name, type: p.type,
      ...(p.values !== undefined ? { values: p.values } : {}),
      ...(p.stages !== undefined ? { stages: p.stages } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.purpose !== undefined ? { purpose: p.purpose } : {}),
    }));
  return { version: 1, owner: PATTER_SCOPES_OWNER, scopes: [{ token: PATTER_SCOPE, declarations }] };
}

/**
 * The write that brings `patter.scopes.json` up to date, or undefined when there is no folder or the
 * file already says exactly this. Never creates the folder: only a folder that was found gets a file.
 */
export function patterScopesWrite(project: ProjectFile, gameScopes: GameScopes | undefined): PlannedWrite | undefined {
  if (!gameScopes || !existsSync(gameScopes.dir)) return undefined;
  const content = serialiseScopesFile(patterScopesFile(project));
  if (content === gameScopes.patterText) return undefined;
  return { path: join(gameScopes.dir, PATTER_SCOPES_FILE), content };
}

/** The warning `validate` gives when `patter.scopes.json` doesn't say what the project would write. */
export function patterScopesStale(project: ProjectFile, gameScopes: GameScopes | undefined): { file: string; message: string } | undefined {
  if (!gameScopes) return undefined;
  if (serialiseScopesFile(patterScopesFile(project)) === gameScopes.patterText) return undefined;
  return {
    file: join(gameScopes.dir, PATTER_SCOPES_FILE),
    message: `${GAME_SCOPES_DIR}/${PATTER_SCOPES_FILE} is ${gameScopes.patterText === undefined ? "missing" : "out of date"}: save the project in Patterpad or run export`,
  };
}

/**
 * The registry a PREVIEW builds its engine on, when the project has game scopes and the bundle names
 * someone else's scope (`@story`, a game scope the project doesn't declare): every scope in the folder
 * but Patter's, stood in from its declared defaults, plus the bundle's own host scopes, since an engine
 * given a registry self-backs nothing. Undefined when a preview needs no stand-ins, so the engine makes
 * its own registry exactly as before. Preview only: a game's registry holds the real engines.
 */
export function previewRegistry(gameScopes: GameScopes | undefined, bundle: Bundle, into?: ScopeRegistry): ScopeRegistry | undefined {
  if (!gameScopes || !bundle.externalScopes?.length) return undefined;
  const registry = into ?? standInRegistry(gameScopes.merged, { except: [PATTER_SCOPE] });
  // Topping up a running preview's registry (a live refresh) adds only what it lacks: every value the
  // run has so far stays where it is.
  if (into) {
    for (const s of gameScopes.merged.spec.scopes) {
      if (s.token === PATTER_SCOPE || registry.has(s.token)) continue;
      registry.defineOwned(s.token, ownedDecls(s), { owner: gameScopes.merged.owners.get(s.token)?.owner ?? GAME_SCOPES_OWNER });
    }
  }
  // An engine given a registry self-backs nothing, so the bundle's own host scopes go in here, as a
  // standalone engine would self-back them.
  for (const spec of bundle.scopeRegistry?.scopes ?? []) {
    if (!registry.has(spec.token)) registry.defineOwned(spec.token, ownedDecls(spec), { owner: PATTER_SCOPES_OWNER });
  }
  return registry;
}

/** A scope's declarations for an owned bag: the scope's `writable` binds each declaration that doesn't
 *  say otherwise, as it does in a foreign scope, so a preview refuses the writes a game would. */
function ownedDecls(s: ScopeSpec | HostScopeSpec): ScopeDeclaration[] {
  return (s.declarations ?? []).map((d) => {
    const writable = d.writable ?? s.writable;
    return {
      name: d.name, type: d.type, values: d.values, stages: d.stages, default: d.default,
      ...(writable !== undefined ? { writable } : {}),
    };
  });
}

/**
 * The scopes a coverage run can feed and must treat as the game's to write: the bundle's host scopes,
 * and, where a preview stands other scopes in (`previewRegistry`), those too. Without a folder, just the
 * bundle's host scopes, which are the project's own.
 */
export function drivableScopes(loaded: { gameScopes?: GameScopes }, bundle: Bundle): Array<{ token: string; declarations?: ScopeDeclaration[] }> {
  const own = (bundle.scopeRegistry?.scopes ?? []) as Array<{ token: string; declarations?: ScopeDeclaration[] }>;
  if (!loaded.gameScopes || !bundle.externalScopes?.length) return own;
  const have = new Set(own.map((s) => s.token));
  return [...own, ...loaded.gameScopes.merged.spec.scopes.filter((s) => s.token !== PATTER_SCOPE && !have.has(s.token))];
}

/** The tokens of `drivableScopes`. */
export const hostScopeTokens = (loaded: { gameScopes?: GameScopes }, bundle: Bundle): Set<string> =>
  new Set(drivableScopes(loaded, bundle).map((s) => s.token));

/** The folder's properties for an expression editor's picker, every scope but Patter's own. */
export const gameScopesCatalogue = (gameScopes: GameScopes | undefined): ScopesCatalogueEntry[] =>
  gameScopes ? scopesCatalogue(gameScopes.merged, { except: [PATTER_SCOPE] }) : [];

/** The folder's tokens, every one but Patter's own: an editor's parser must know them all. */
export const gameScopeTokens = (gameScopes: GameScopes | undefined): string[] =>
  (gameScopes?.merged.spec.scopes ?? []).map((s) => s.token).filter((t) => t !== PATTER_SCOPE);

/** A scopes-file scope as a host scope (the shapes match). */
const asHostScope = (s: ScopeSpec): HostScopeSpec => ({
  token: s.token,
  ...(s.writable !== undefined ? { writable: s.writable } : {}),
  ...(s.declarations ? { declarations: s.declarations.map((d) => ({ ...d })) } : {}),
});

/**
 * A scope the game provides, which `game.scopes.json` holds: any token but Patter's own, the family's
 * other engines' (`@story` is the Storylet Engine's to declare), and one another tool's file claims.
 */
function isGameToken(token: string, merged: MergedScopes | undefined): boolean {
  if (token === PATTER_SCOPE || EXTERNAL_SCOPES.includes(token)) return false;
  const who = merged?.owners.get(token);
  return !who || who.fileName === GAME_SCOPES_FILE;
}

/**
 * The host scopes World properties shows: the project's, with each one `game.scopes.json` declares
 * taken from there (the shared file is the source; the project holds a synced copy), and the shared
 * `@world` added when the project has none. Without a folder, the project's own.
 */
export function worldSettingsScopes(project: ProjectFile, gameScopes: GameScopes | undefined): HostScopeRegistry | undefined {
  const own = project.scopeRegistry;
  if (!gameScopes) return own;
  const merged = gameScopes.merged;
  const fromGame = (token: string): ScopeSpec | undefined =>
    merged.owners.get(token)?.fileName === GAME_SCOPES_FILE ? merged.spec.scopes.find((s) => s.token === token) : undefined;
  const scopes = (own?.scopes ?? []).map((h) => { const g = fromGame(h.token); return g ? asHostScope(g) : h; });
  const world = fromGame("world");
  if (world && !scopes.some((s) => s.token === "world")) scopes.push(asHostScope(world));
  return scopes.length ? { version: own?.version ?? 1, scopes } : undefined;
}

/**
 * Save World properties where the project has a game scopes folder: the game's own scopes go to
 * `game.scopes.json` FIRST (re-read just now, so another tool's edit since is kept, and every scope this
 * project doesn't show is left exactly as it was), then the project keeps the same scopes as its synced
 * copy, so it still compiles packed or checked out alone. Another engine's scope stays in the project
 * only. Returns the write for the shared file (none when its text wouldn't change), and the project's
 * host scopes; or an error when the shared file is there but won't parse, rather than overwrite it.
 */
export function planWorldSave(project: ProjectFile, gameScopes: GameScopes, next: HostScopeRegistry | undefined):
  { write?: PlannedWrite; scopeRegistry?: HostScopeRegistry; error?: string } {
  const path = join(gameScopes.dir, GAME_SCOPES_FILE);
  let current: ScopesFile | undefined;
  let text: string | undefined;
  if (existsSync(path)) {
    text = readFileSync(path, "utf8");
    const parsed = parseScopesFile(text, GAME_SCOPES_FILE);
    if (!parsed.file) return { error: `${GAME_SCOPES_DIR}/${GAME_SCOPES_FILE} won't parse, so it was left alone: ${parsed.issues.map((i) => i.message).join("; ")}` };
    current = parsed.file;
  }
  const merged = readGameScopes(gameScopes.dir).merged; // who owns what NOW, not when the project opened
  const ui = next?.scopes ?? [];
  const scopes: ScopeSpec[] = [...(current?.scopes ?? [])];
  for (const h of ui) {
    if (!isGameToken(h.token, merged)) continue;
    const at = scopes.findIndex((s) => s.token === h.token);
    const spec: ScopeSpec = {
      token: h.token,
      ...(h.writable !== undefined ? { writable: h.writable } : {}),
      ...(h.declarations ? { declarations: h.declarations.map((d) => ({ ...d })) } : {}),
    };
    if (at >= 0) scopes[at] = spec; else scopes.push(spec);
  }
  // A game scope the settings showed and no longer hold was deleted there: `@world`, and whatever the
  // project declared. One the project never declared was not shown, so it stays.
  const shown = new Set(["world", ...(project.scopeRegistry?.scopes ?? []).map((s) => s.token)]);
  const kept = scopes.filter((s) => !(shown.has(s.token) && isGameToken(s.token, merged) && !ui.some((h) => h.token === s.token)));
  const file: ScopesFile = { version: current?.version ?? 1, owner: current?.owner ?? GAME_SCOPES_OWNER, scopes: kept };
  const content = serialiseScopesFile(file);
  const write = content === text || (!current && kept.length === 0) ? undefined : { path, content };
  return { ...(write ? { write } : {}), ...(next && next.scopes.length ? { scopeRegistry: next } : {}) };
}

/**
 * Merging a returned pack (patterkit/design/shared-scopes.md, "Packs"): the recipient's World edit comes
 * back in the project's synced copy of the game's scopes, and the sender's `game.scopes.json` must take
 * it, or the next save would sync the copy from the shared file and silently drop it. The scopes the
 * returned project file declares differently from the base pack's are the ones the recipient changed
 * (added, edited, or deleted); each goes to `game.scopes.json` as the MERGED project has it, through the
 * World settings' own save, and every other scope in the file stays exactly as it is now. Nothing (no
 * write) when the recipient changed none of the game's scopes; an error when the file won't parse.
 */
export function planReturnedWorld(ours: ProjectFile, base: ProjectFile, theirs: ProjectFile, merged: ProjectFile, gameScopes: GameScopes):
  { write?: PlannedWrite; error?: string } {
  const now = readGameScopes(gameScopes.dir); // who owns what NOW, and what the file says NOW
  const game = (p: ProjectFile): Map<string, string> => new Map((p.scopeRegistry?.scopes ?? [])
    .filter((s) => isGameToken(s.token, now.merged)).map((s) => [s.token, canonicalStringify(s)]));
  const was = game(base), came = game(theirs);
  const changed = new Set([...was.keys(), ...came.keys()].filter((t) => was.get(t) !== came.get(t)));
  if (!changed.size) return {};
  // The settings' save takes the scopes as they should now be: the file's own for every token the
  // recipient left alone (so each is rewritten as it is), and the merged project's for the rest. A
  // changed token the merged project no longer has was deleted, which the save does for a token it was
  // shown: the base's and ours' are, so one either side declared goes.
  const file = now.files.find((f) => f.fileName === GAME_SCOPES_FILE)?.file;
  const next: HostScopeRegistry = { version: 1, scopes: [
    ...(file?.scopes ?? []).filter((s) => !changed.has(s.token)).map(asHostScope),
    ...(merged.scopeRegistry?.scopes ?? []).filter((s) => changed.has(s.token)),
  ] };
  const shown: ProjectFile = { ...ours, scopeRegistry: { version: 1, scopes: [...(ours.scopeRegistry?.scopes ?? []), ...(base.scopeRegistry?.scopes ?? [])] } };
  const plan = planWorldSave(shown, gameScopes, next);
  return { ...(plan.write ? { write: plan.write } : {}), ...(plan.error ? { error: plan.error } : {}) };
}

/**
 * Where "Share scopes with other tools" suggests creating the folder: at the version-control root above
 * the project (the first folder holding `.git`), else beside the project folder.
 */
export function defaultGameScopesDir(root: string): string {
  for (let dir = resolve(root); ; ) {
    if (existsSync(join(dir, ".git"))) return join(dir, GAME_SCOPES_DIR);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(dirname(resolve(root)), GAME_SCOPES_DIR);
}

/**
 * Share a project's scopes with the game's other tools: create `game-scopes/` at `dir` with Patter's
 * file and `game.scopes.json` holding the project's own game scopes (its host scopes, but not another
 * engine's, which is that engine's to declare). The project keeps its copy. When the walk-up from the
 * project would not find `dir`, the project names it (`gameScopes`), so it is found next time. Returns
 * the writes (the folder comes with the first), and the project as it should now be saved.
 *
 * A folder another tool already made is JOINED, never overwritten: an existing `game.scopes.json` keeps
 * every scope it holds, and gains only the project's game scopes it doesn't declare yet (as the
 * Storylet Engine's share adds `@world` only when the file has none). One that won't parse is an error,
 * and nothing is written.
 */
export function planShareScopes(root: string, project: ProjectFile, dir: string): { writes: PlannedWrite[]; project: ProjectFile } | { error: string } {
  const target = resolve(dir);
  const gamePath = join(target, GAME_SCOPES_FILE);
  let existing: ScopesFile = { version: 1, owner: GAME_SCOPES_OWNER, scopes: [] };
  if (existsSync(gamePath)) {
    const parsed = parseScopesFile(readFileSync(gamePath, "utf8"), GAME_SCOPES_FILE);
    if (!parsed.file) return { error: `${GAME_SCOPES_FILE} in ${target} won't parse, so it was left alone: ${parsed.issues.map((i) => i.message).join("; ")}` };
    existing = parsed.file;
  }
  const held = new Set(existing.scopes.map((s) => s.token));
  const added = (project.scopeRegistry?.scopes ?? []).filter((h) => isGameToken(h.token, undefined) && !held.has(h.token)).map((h) => ({
    token: h.token,
    ...(h.writable !== undefined ? { writable: h.writable } : {}),
    ...(h.declarations ? { declarations: h.declarations.map((d) => ({ ...d })) } : {}),
  }));
  const game: ScopesFile = { ...existing, scopes: [...existing.scopes, ...added] };
  const writes: PlannedWrite[] = [
    { path: join(target, PATTER_SCOPES_FILE), content: serialiseScopesFile(patterScopesFile(project)) },
    { path: gamePath, content: serialiseScopesFile(game) },
  ];
  // Would the walk-up land here? It visits the project folder and each one above, to the VCS root.
  let found = false;
  for (let at = resolve(root); ; ) {
    if (join(at, GAME_SCOPES_DIR) === target) { found = true; break; }
    const up = dirname(at);
    if (existsSync(join(at, ".git")) || up === at) break;
    at = up;
  }
  const { gameScopes: _drop, ...rest } = project;
  const next: ProjectFile = found ? rest : { ...rest, gameScopes: relative(resolve(root), target) || "." };
  return { writes, project: next };
}

export { GAME_SCOPES_DIR, GAME_SCOPES_FILE, serialiseScopesFile };
