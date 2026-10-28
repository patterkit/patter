// ---------------------------------------------------------------------------
// The clash resolver's words (ruling Q21): each `unresolved` entry a merge left in a shard, turned into a
// row a writer reads. Where it is ("Line L_greet in The Tavern", "Property @gold", "Scene order"), the two
// sides as text (a beat's words, not its JSON), whether "Take theirs" can be written, and where Edit goes.
// Pure: the project's lookups come in through `ClashContext`, so this is tested without a project open.
// ---------------------------------------------------------------------------

import { clashPathSegments, isSettableClash, type ClashPathSegment, type MarkedShard, type UnresolvedClash } from "@patterkit/ops";
import { PROJECT_LOCALE_SCENE } from "@patterkit/model";
import type { ClashDto, ClashTarget } from "../shared/api.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** What the words need from the open project. */
export interface ClashContext {
  /** A scene's name, by id. */
  sceneName(sceneId: string): string | undefined;
  /** A scene's tree (as the project holds it now: our side of every clash), by id. */
  sceneTree(sceneId: string): Obj | undefined;
  /** The scene an authoring shard (`.patterx`) belongs to. */
  sceneOfAuthoring(file: string): string | undefined;
  /** A node's text in the project's default language. */
  text(sceneId: string, id: string): string | undefined;
  /** An extension's name, by id (the id when it isn't taken). */
  extensionName(id: string): string;
  /** The project's default language code. */
  defaultLocale: string;
}

/** A shard's file type, from its schema's name (`patter/<name>@n`). */
function shardType(shard: Obj): "flow" | "loc" | "authoring" | "project" | "extension" | undefined {
  const name = /^patter\/([a-z]+)(?:@|$)/.exec(typeof shard["schema"] === "string" ? shard["schema"] : "")?.[1];
  return name === "strings" ? "loc" : name === "flow" || name === "authoring" || name === "project" || name === "extension" ? name : undefined;
}

/** "choiceText" to "choice text". */
const words = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
const capital = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** Long text cut for a label. */
const clip = (s: string, n = 40): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** How a node's field reads after its owner: "speaker", "choice text", "mood (game data)". */
function fieldWords(segs: readonly ClashPathSegment[]): string {
  const [first, second] = segs;
  if (!first) return "";
  if (first.key === "gameData" && second) return `${second.key} (game data)`;
  if (first.key === "character") return "speaker";
  if (first.key === "gameId") return "Game ID";
  if (first.key === "jump") return "jump";
  return words(first.key);
}

// --- finding a node in a scene's tree ----------------------------------------------------------------

interface Found { node: Obj; block?: Obj }

/** A node with this id anywhere in the scene (blocks, their children, groups' children, beats, prompts). */
function findNode(scene: Obj | undefined, id: string): Found | undefined {
  if (!scene) return undefined;
  if (scene["id"] === id) return { node: scene };
  let hit: Found | undefined;
  const walk = (n: unknown, block: Obj | undefined): void => {
    if (hit || !isObj(n)) return;
    if (n["id"] === id) { hit = { node: n, ...(block ? { block } : {}) }; return; }
    const inBlock = n["type"] === "block" ? n : block;
    for (const k of ["blocks", "children", "beats"]) if (Array.isArray(n[k])) for (const c of n[k] as unknown[]) walk(c, inBlock);
    if (isObj(n["prompt"])) walk(n["prompt"], inBlock);
  };
  walk(scene, undefined);
  return hit;
}

/** A node as a writer would name it: "Line L_greet", "Block Outside", "Option “Ask about rumours”". */
function thingWords(ctx: ClashContext, sceneId: string, node: Obj | undefined, id: string): string {
  if (!node) return `Node ${id}`;
  const type = node["type"], kind = node["kind"];
  if (type === "scene") return `Scene ${String(node["name"] ?? id)}`;
  if (type === "block") return `Block ${String(node["name"] ?? id)}`;
  if (type === "group") return `Group ${id}`;
  if (type === "snippet") {
    const prompt = isObj(node["prompt"]) && typeof node["prompt"]["id"] === "string" ? ctx.text(sceneId, node["prompt"]["id"]) : undefined;
    if (prompt) return `Option “${clip(prompt)}”`;
    return `Snippet ${id}`;
  }
  if (kind === "line") return `Line ${id}`;
  if (kind === "text") return `Text ${id}`;
  if (kind === "gameEvent") return `Game event ${id}`;
  return `Beat ${id}`;
}

/** The innermost node a flow path names, and the steps after it (its field). */
function lastNode(segs: readonly ClashPathSegment[]): { id?: string; rest: ClashPathSegment[]; at: number } {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i]!.bracket) return { id: segs[i]!.key, rest: segs.slice(i + 1), at: i };
  return { rest: segs.slice(1), at: -1 };
}

// --- values as text ----------------------------------------------------------------------------------

/** A value as text: a string as it is, a list of words joined, a beat as its speaker and words, a node by
 *  what it holds, and anything else as `key: value` pairs, never as JSON braces at the top level. */
function valueText(ctx: ClashContext, sceneId: string | undefined, v: unknown, order = false): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) return "(none)";
  if (typeof v === "string") return v === "" ? "(empty)" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "(none)";
    if (v.every((x) => typeof x === "string")) {
      // An order: each id as a writer knows it, one after another.
      if (order && sceneId) {
        const tree = ctx.sceneTree(sceneId);
        return (v as string[]).map((id) => thingWords(ctx, sceneId, findNode(tree, id)?.node, id)).join(", then ");
      }
      return (v as string[]).join(", ");
    }
    return v.map((x) => valueText(ctx, sceneId, x) ?? "").join("; ");
  }
  if (!isObj(v)) return String(v);
  const id = typeof v["id"] === "string" ? v["id"] : undefined;
  if (id && typeof v["kind"] === "string" && sceneId) {
    // A beat: "BARKEEP: Welcome, traveller."
    const text = ctx.text(sceneId, id);
    const who = typeof v["character"] === "string" ? `${v["character"]}: ` : "";
    if (v["kind"] === "gameEvent") return `Game event ${id}${isObj(v["gameData"]) ? ` (${pairs(v["gameData"])})` : ""}`;
    return `${who}${text ?? "(no text)"}`;
  }
  if (id && typeof v["type"] === "string" && sceneId) {
    // A block, group, or snippet: what it says, beat by beat.
    const beats: string[] = [];
    const walk = (n: unknown): void => {
      if (!isObj(n)) return;
      if (typeof n["kind"] === "string" && typeof n["id"] === "string") { beats.push(valueText(ctx, sceneId, n) ?? ""); return; }
      if (isObj(n["prompt"])) walk(n["prompt"]);
      for (const k of ["children", "beats"]) if (Array.isArray(n[k])) for (const c of n[k] as unknown[]) walk(c);
    };
    walk(v);
    const head = v["type"] === "block" ? `Block ${String(v["name"] ?? id)}` : v["type"] === "group" ? "A group" : "A snippet";
    return beats.length ? `${head}: ${beats.join(" / ")}` : `${head}, empty`;
  }
  if (typeof v["body"] === "string") return `${typeof v["author"] === "string" ? `${v["author"]}: ` : ""}${v["body"]}`; // a comment message
  if (Array.isArray(v["messages"])) return (v["messages"] as unknown[]).map((m) => valueText(ctx, sceneId, m) ?? "").join(" / "); // a thread
  if (typeof v["proposed"] === "string") return `Suggests “${v["proposed"]}”${typeof v["outcome"] === "string" ? `, ${v["outcome"]}` : ""}`; // a suggestion
  return pairs(v);
}

/** An object's fields as `key: value`, nested values in compact JSON. */
function pairs(o: Obj): string {
  // A declaration's name first: canonical text sorts keys, which buries it.
  const out = Object.entries(o).filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => Number(b === "name") - Number(a === "name"))
    .map(([k, x]) => `${words(k)}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
  return out.length ? out.join(", ") : "(empty)";
}

// --- where a clash is, per shard type ----------------------------------------------------------------

interface Placed { where: string; target: ClashTarget; sceneId?: string; order?: boolean }

const ORDER_OF: Record<string, string> = { blocks: "Block order", children: "Order of what's in it", beats: "Beat order" };

function placeFlow(ctx: ClashContext, shard: Obj, path: string, kind: string): Placed {
  const scene = isObj(shard["scene"]) ? shard["scene"] : {};
  const sceneId = String(scene["id"] ?? "");
  const sceneName = String(scene["name"] ?? ctx.sceneName(sceneId) ?? sceneId);
  const segs = clashPathSegments(path);
  if (segs[0]?.key !== "scene") return { where: `${capital(words(segs[0]?.key ?? path))} of ${sceneName}`, target: { kind: "scene", sceneId, title: true }, sceneId };
  if (kind === "structural") {
    const id = segs.find((s) => s.bracket)?.key ?? "";
    return { where: `Two nodes with the id ${id} in ${sceneName}`, target: { kind: "scene", sceneId, nodeId: id }, sceneId };
  }
  const tree = ctx.sceneTree(sceneId) ?? scene;
  const { id, rest } = lastNode(segs);
  if (kind === "moved") {
    // The path names the list both sides reordered: its last step is the list's key.
    const list = segs[segs.length - 1]!.key;
    const ownerId = id;
    const owner = ownerId ? findNode(tree, ownerId)?.node : undefined;
    const ofWhat = ownerId ? thingWords(ctx, sceneId, owner, ownerId) : undefined;
    const label = ORDER_OF[list] ?? `Order of ${words(list)}`;
    return {
      where: ofWhat ? `${list === "children" ? `Order of what's in ${ofWhat}` : `${label} in ${ofWhat}`} in ${sceneName}` : `${label} in ${sceneName}`,
      target: { kind: "scene", sceneId, ...(ownerId ? { nodeId: ownerId } : { title: true }) }, sceneId, order: true,
    };
  }
  if (!id) {
    // A field of the scene itself: its name, its Game ID, its game data.
    const field = fieldWords(rest);
    return { where: field ? `${sceneName}'s ${field}` : sceneName, target: { kind: "scene", sceneId, title: true }, sceneId };
  }
  const found = findNode(tree, id);
  const thing = thingWords(ctx, sceneId, found?.node, id);
  const field = fieldWords(rest);
  return { where: `${thing}${field ? `'s ${field}` : ""} in ${sceneName}`, target: { kind: "scene", sceneId, nodeId: id }, sceneId };
}

function placeLoc(ctx: ClashContext, shard: Obj, path: string): Placed {
  const sceneId = String(shard["scene"] ?? "");
  const locale = String(shard["locale"] ?? "");
  const segs = clashPathSegments(path);
  const language = locale && locale !== ctx.defaultLocale ? `${languageName(locale)} ` : "";
  if (sceneId === PROJECT_LOCALE_SCENE) {
    const key = segs[1]?.key ?? path;
    return { where: `The project's ${language}string ${key}`, target: { kind: "settings", tab: locale && locale !== ctx.defaultLocale ? "language" : "cast" } };
  }
  const sceneName = ctx.sceneName(sceneId) ?? sceneId;
  if (segs[0]?.key !== "strings" || !segs[1]) return { where: `${sceneName}'s ${language}strings (${words(segs[0]?.key ?? path)})`, target: { kind: "scene", sceneId, title: true }, sceneId };
  const id = segs[1].key;
  const thing = thingWords(ctx, sceneId, findNode(ctx.sceneTree(sceneId), id)?.node, id);
  // The source language's words are the line itself ("Line L12 in The Tavern"); a translation says which.
  return { where: `${thing} in ${sceneName}${language ? `, in ${language.trim()}` : ""}`, target: { kind: "scene", sceneId, nodeId: id }, sceneId };
}

const AUTHORING_WORDS: Record<string, string> = {
  writing: "writing status", recording: "recording status", audio: "audio", documentation: "notes", cut: "cut",
  rerecord: "re-record flag",
};

function placeAuthoring(ctx: ClashContext, shard: Obj, file: string, path: string): Placed {
  const sceneId = ctx.sceneOfAuthoring(file) ?? "";
  const sceneName = ctx.sceneName(sceneId) ?? "the project";
  const segs = clashPathSegments(path);
  const head = segs[0]?.key ?? path;
  const id = segs[1]?.key;
  const tree = ctx.sceneTree(sceneId);
  const nodeTarget = (nodeId: string | undefined): ClashTarget => (sceneId ? { kind: "scene", sceneId, ...(nodeId ? { nodeId } : { title: true }) } : { kind: "none" });
  if (head in AUTHORING_WORDS && id) {
    const thing = thingWords(ctx, sceneId, findNode(tree, id)?.node, id);
    return { where: `${thing}'s ${AUTHORING_WORDS[head]} in ${sceneName}`, target: nodeTarget(id), sceneId };
  }
  if ((head === "comments" || head === "suggestions") && id) {
    const record = [...(Array.isArray(shard[head]) ? shard[head] as unknown[] : [])].find((r) => isObj(r) && r["id"] === id) as Obj | undefined;
    const anchor = typeof record?.["anchor"] === "string" ? record["anchor"] : undefined;
    const on = anchor ? ` on ${thingWords(ctx, sceneId, findNode(tree, anchor)?.node, anchor)}` : "";
    const what = head === "comments" ? (segs.length > 2 ? "A comment" : "A comment thread") : "A suggestion";
    return { where: `${what}${on} in ${sceneName}`, target: nodeTarget(anchor), sceneId };
  }
  return { where: `${capital(words(head))} in ${sceneName}'s review file`, target: nodeTarget(undefined), sceneId };
}

/** The Project Settings tab each project key is edited on (renderer.ts `buildSettingsDialog`). */
const SETTINGS_TAB: Record<string, string> = {
  project: "general", start: "general", voiced: "general", formatting: "general", padAfterDefault: "general",
  vcs: "vcs", export: "build", autoRebuild: "build", cast: "cast", qualifiers: "qualifiers", speakerPattern: "qualifiers",
  gameDataFields: "gamedata", writingStatuses: "writing-status", recordingStatuses: "recording-status", trackAudioStatus: "recording-status",
  audioRoot: "recording-status", audioFolders: "recording-status", scratchStatus: "recording-status", estimating: "estimating",
  closedCaptions: "captions", dictionary: "dictionary", locales: "language", localiseDialogueText: "language",
  scopeRegistry: "world", gameScopes: "world",
};

const PROJECT_WORDS: Record<string, string> = {
  sceneOrder: "Scene order", start: "The start scene", project: "The project's name", locales: "The project's languages",
  vcs: "The project's version control", voiced: "Whether the project is voiced", closedCaptions: "Closed captions",
  writingStatuses: "Writing statuses", recordingStatuses: "Recording statuses", dictionary: "The dictionary",
  estimating: "Estimating settings", export: "Publish settings",
};

function placeProject(ctx: ClashContext, path: string): Placed {
  const segs = clashPathSegments(path);
  const head = segs[0]?.key ?? path;
  const key = segs[1]?.key;
  const order = path.endsWith(":order");
  const settings = (tab: string, row?: string): ClashTarget => ({ kind: "settings", tab, ...(row ? { row } : {}) });
  if (head === "properties") {
    if (order || !key) return { where: "Property order", target: { kind: "properties" } };
    return { where: segs[2] ? `@${key}'s ${words(segs[2].key)}` : `Property @${key}`, target: { kind: "properties", name: key } };
  }
  if (head === "cast") {
    if (order || !key) return { where: "Cast order", target: settings("cast") };
    const field = segs[2]?.key;
    if (field === "qualifierLabels" && segs[3]) return { where: `${key}'s label with ${segs[3].key}`, target: settings("cast", key) };
    return { where: field ? `${key}'s ${words(field)}` : `Cast member ${key}`, target: settings("cast", key) };
  }
  if (head === "gameDataFields") {
    const field = segs[2]?.key;
    const kind = key ? words(key) : "";
    if (order || !field) return { where: `Order of the game data fields on ${kind}s`, target: settings("gamedata") };
    return { where: `Game data field ${field} on ${kind}s`, target: settings("gamedata", field) };
  }
  if (head === "qualifiers") return { where: key ? `Qualifier ${key}` : "Qualifiers", target: settings("qualifiers", key) };
  if (head === "locales") return { where: key === "default" ? "The default language" : "The project's languages", target: settings("language") };
  if (head === "extensions" && key) {
    const field = segs[2]?.key;
    return { where: `${ctx.extensionName(key)}'s ${field ? words(field) : "settings"}`, target: { kind: "settings", tab: `extension:${key}` } };
  }
  if (head === "sceneOrder") return { where: "Scene order", target: { kind: "none" } };
  const tab = SETTINGS_TAB[head] ?? "general";
  return { where: PROJECT_WORDS[head] ?? `The project's ${words(head)} setting`, target: settings(tab) };
}

function placeExtension(ctx: ClashContext, shard: Obj, path: string): Placed {
  const ext = String(shard["extension"] ?? "");
  const name = ctx.extensionName(ext);
  const sceneId = String(shard["scene"] ?? "");
  const segs = clashPathSegments(path);
  // entries.<kind>.<node id>.<field>...
  const kind = segs[1]?.key, id = segs[2]?.key, field = segs[3]?.key;
  if (sceneId === PROJECT_LOCALE_SCENE || !ctx.sceneName(sceneId)) {
    const of = kind && id ? ` on ${words(kind)} ${id}` : kind ? ` on ${words(kind)}s` : "";
    return { where: `${name}${field ? ` ${words(field)}` : " data"}${of}`, target: { kind: "settings", tab: `extension:${ext}` } };
  }
  const sceneName = ctx.sceneName(sceneId)!;
  if (!id) return { where: `${name} data on every ${words(kind ?? "node")} in ${sceneName}`, target: { kind: "scene", sceneId, title: true }, sceneId };
  const thing = thingWords(ctx, sceneId, findNode(ctx.sceneTree(sceneId), id)?.node, id);
  return { where: `${thing}'s ${name}${field ? ` ${words(field)}` : " data"} in ${sceneName}`, target: { kind: "scene", sceneId, nodeId: id }, sceneId };
}

/** A language code as its English name ("fr" to "French"), the code itself when it isn't one. */
function languageName(code: string): string {
  try { return new Intl.DisplayNames(["en-GB"], { type: "language" }).of(code) ?? code; } catch { return code; }
}

// --- the row ------------------------------------------------------------------------------------------

/** The kinds the shell has no words for, and the order clashes the shared merge calls `both-changed`. */
function kindLabel(c: UnresolvedClash): string | undefined {
  if (c.kind === "moved") return "Moved on both sides";
  if (c.kind === "no-timestamp") return "Both sides changed it, with no edit times to say which came last";
  if (c.path.endsWith(":order")) return "Reordered on both sides";
  return undefined;
}

/** A clash's id: the shard's path from the project root, and the clash's path in it. */
export const clashId = (rel: string, path: string): string => `${rel}#${path}`;
/** The two halves of a clash id. */
export function splitClashId(id: string): { rel: string; path: string } {
  const i = id.indexOf("#");
  return i < 0 ? { rel: id, path: "" } : { rel: id.slice(0, i), path: id.slice(i + 1) };
}

/** One shard's clashes as rows, and where Edit goes for each. `rel` is the shard's path from the root. */
export function describeClashes(ctx: ClashContext, marked: MarkedShard, rel: string): Array<{ clash: ClashDto; target: ClashTarget }> {
  const type = shardType(marked.shard);
  return marked.clashes.map((c) => {
    const placed: Placed = type === "flow" ? placeFlow(ctx, marked.shard, c.path, c.kind)
      : type === "loc" ? placeLoc(ctx, marked.shard, c.path)
      : type === "authoring" ? placeAuthoring(ctx, marked.shard, marked.file, c.path)
      : type === "project" ? placeProject(ctx, c.path)
      : type === "extension" ? placeExtension(ctx, marked.shard, c.path)
      : { where: `${rel}: ${c.path}`, target: { kind: "none" } };
    const order = placed.order || c.path.endsWith(":order");
    const label = kindLabel(c);
    const ours = valueText(ctx, placed.sceneId, c.ours, order);
    const theirs = valueText(ctx, placed.sceneId, c.theirs, order);
    const base = valueText(ctx, placed.sceneId, c.base, order);
    // The sidecar's notes on this place (both sides inserting at one spot, a renamed Game ID).
    const notes = (marked.sidecar?.warnings ?? []).filter((w) => w.path === c.path || w.path.startsWith(`${c.path}.`) || w.path.startsWith(`${c.path}[`))
      .map((w) => capital(w.message.trim()).replace(/\s+-\s+/g, ": "));
    const clash: ClashDto = {
      id: clashId(rel, c.path), where: placed.where, path: c.path, kind: c.kind, settable: isSettableClash(c),
      ...(label ? { kindLabel: label } : {}),
      ...(ours !== undefined ? { ours } : {}), ...(theirs !== undefined ? { theirs } : {}), ...(base !== undefined ? { base } : {}),
      ...(notes.length ? { detail: notes.map((n) => (/[.!?]$/.test(n) ? n : `${n}.`)).join(" ") } : {}),
    };
    return { clash, target: placed.target };
  });
}
