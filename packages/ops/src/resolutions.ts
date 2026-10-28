// ---------------------------------------------------------------------------
// Settling the clashes a merge left (ruling Q21, the one clash resolver). A merged shard holds OUR side of
// each clash and names it under the reserved `unresolved` key (merge.ts); each entry carries the path, the
// kind, and the three sides, so the shard alone is enough to settle it. `applyResolutions` takes a marked
// shard's text and a decision per path and gives back the shard's new canonical text:
//
//   - "ours"     keep the value the shard already holds, and clear the entry;
//   - "theirs"   write their value at the path (or remove what's there, when theirs had none), and clear;
//   - "resolved" clear only: the author has edited the place by hand and what's there now stands.
//
// Pure: text in, text out. The apps write the result through their own writer, as one undoable step.
//
// The path grammar is the merge's (merge.ts and `@wildwinter/toolkit/extensions`' `mergeTree`): segments
// joined by `.key` or `[key]` (a bracketed key may be JSON-quoted), where a key into a list names the
// element whose identity is that key (a node's `id`, a declaration's `name`, a qualifier's `gameId`, a
// comment message's `author|ts`). Two kinds of clash aren't one value, so "theirs" can't be written for
// them: `moved` (both sides reordered a list differently; the path names the list) and `structural` (a
// post-merge check failed, a duplicate id). Nor can an `:order` clash, the shared merge's word for the same
// thing in a declaration list. Those are settled by keeping ours or by editing in the app.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { DEFAULT_QUALIFIERS } from "@patterkit/model";
import { clearUnresolved, unresolvedOf } from "@wildwinter/toolkit/extensions";
import { walkFilesByExt } from "./load.js";
import { CONFLICT_SIDECAR } from "./merge.js";
import { SHARD_EXTENSIONS } from "./pack.js";

/** What to do with one clash. */
export type Resolution = "ours" | "theirs" | "resolved";

/** One decision: the clash's path, as the shard's `unresolved` entry names it, and what to do. */
export interface ResolutionDecision {
  path: string;
  decision: Resolution;
}

/** One `unresolved` entry, as the shard holds it. */
export interface UnresolvedClash {
  path: string;
  kind: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
}

/** Thrown when a decision can't be applied: no such clash, or "theirs" for a clash that isn't one value. */
export class ResolutionError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The kinds that aren't one value: their "theirs" is an order or a check, not something to write. */
const UNSETTABLE_KINDS = new Set(["moved", "structural"]);

/** Can "theirs" be written for this clash? False for `moved`, `structural`, and a list's `:order`. */
export function isSettableClash(clash: { path: string; kind?: unknown }): boolean {
  if (typeof clash.kind !== "string" || UNSETTABLE_KINDS.has(clash.kind)) return false;
  return !clash.path.endsWith(":order");
}

/** The `unresolved` entries of a parsed shard (none for a shard with no mark). An entry with no path can't
 *  be named, so it isn't listed: validate still refuses it, and only an edit by hand clears it. */
export function unresolvedClashes(shard: unknown): UnresolvedClash[] {
  const out: UnresolvedClash[] = [];
  for (const e of unresolvedOf(shard) ?? []) {
    if (!isObj(e) || typeof e["path"] !== "string") continue;
    const c: UnresolvedClash = { path: e["path"], kind: typeof e["kind"] === "string" ? e["kind"] : "" };
    if ("base" in e) c.base = e["base"];
    if ("ours" in e) c.ours = e["ours"];
    if ("theirs" in e) c.theirs = e["theirs"];
    out.push(c);
  }
  return out;
}

/** One step of a clash path: a key after a dot, or a key in brackets. */
export interface ClashPathSegment {
  key: string;
  /** In brackets, unquoted: a key into a list. A JSON-quoted key is an object's key, as a dotted one is. */
  bracket: boolean;
}

/**
 * A clash path's steps, in order: `scene.blocks[b1].children[x].choiceText` is scene, blocks, [b1],
 * children, [x], choiceText. A trailing `:order` (the shared merge's order clash) is left off. A
 * bracketed key may hold anything but `]` (a message's `author|ts` has colons in it), or be JSON-quoted.
 */
export function clashPathSegments(path: string): ClashPathSegment[] {
  const p = path.endsWith(":order") ? path.slice(0, -":order".length) : path;
  const out: ClashPathSegment[] = [];
  let i = 0;
  while (i < p.length) {
    if (p[i] === ".") { i++; continue; }
    if (p[i] === "[") {
      if (p[i + 1] === "\"") {
        // A JSON-quoted key (`atKey` writes one for a key that isn't an identifier).
        let j = i + 2;
        while (j < p.length && !(p[j] === "\"" && p[j - 1] !== "\\")) j++;
        let key: string;
        try { key = JSON.parse(p.slice(i + 1, j + 1)) as string; } catch { key = p.slice(i + 2, j); }
        out.push({ key, bracket: false });
        i = p.indexOf("]", j) + 1 || p.length;
        continue;
      }
      const end = p.indexOf("]", i);
      out.push({ key: p.slice(i + 1, end < 0 ? p.length : end), bracket: true });
      i = end < 0 ? p.length : end + 1;
      continue;
    }
    let j = i;
    while (j < p.length && p[j] !== "." && p[j] !== "[") j++;
    out.push({ key: p.slice(i, j), bracket: false });
    i = j;
  }
  return out;
}

/** The identity of a list element, as the merge keys it: a node or a record by `id`, a declaration by
 *  `name`, a qualifier by `gameId`, a comment message by `author|ts`. */
function elementMatches(el: unknown, key: string): boolean {
  if (!isObj(el)) return false;
  if (el["id"] === key || el["name"] === key || el["gameId"] === key) return true;
  return "ts" in el && `${String(el["author"] ?? "")}|${String(el["ts"] ?? "")}` === key;
}

/** The value at a clash path in a parsed shard, or undefined where there's none. */
export function valueAtClashPath(shard: unknown, path: string): unknown {
  let at: unknown = shard;
  for (const { key } of clashPathSegments(path)) {
    if (Array.isArray(at)) at = at.find((el) => elementMatches(el, key));
    else if (isObj(at)) at = at[key];
    else return undefined;
  }
  return at;
}

/** The lists a dotted key reaches into by identity (the merge keys these by `mergeMap` over an index). */
const DOTTED_LISTS = new Set(["qualifiers", "suggestions"]);

/** What a missing container on the way to a path starts as: a list where the next step keys into one, the
 *  default qualifiers where the project leaves them implicit, an object otherwise. */
function emptyContainer(key: string, next: ClashPathSegment, depth: number): Obj | unknown[] {
  if (depth === 0 && key === "qualifiers") return structuredClone(DEFAULT_QUALIFIERS) as unknown[];
  return next.bracket || (depth === 0 && DOTTED_LISTS.has(key)) ? [] : {};
}

/** Write `value` at `path` in `root` (in place), or remove what's there when `value` is undefined. A missing
 *  object on the way is made; an object a removal empties is removed too (storage is sparse: a beat with no
 *  game data carries no `gameData`), but a list never is, nor one of the shard's own keys, (an empty `beats` is a shape of its own). */
function setAtPath(root: Obj, path: string, value: unknown): void {
  const segs = clashPathSegments(path);
  if (segs.length === 0) throw new ResolutionError(`"${path}" doesn't name a place in the shard`);
  const chain: Array<{ parent: Obj | unknown[]; key: string }> = [];
  let at: Obj | unknown[] = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i]!.key;
    let next: unknown;
    if (Array.isArray(at)) {
      next = at.find((el) => elementMatches(el, key));
      if (next === undefined) {
        if (value === undefined) return; // nothing there to remove
        throw new ResolutionError(`"${path}": nothing in the shard is "${key}", so their value has nowhere to go`);
      }
    } else {
      next = at[key];
      if (next === undefined) {
        if (value === undefined) return;
        next = emptyContainer(key, segs[i + 1]!, i);
        at[key] = next;
      }
    }
    if (!isObj(next) && !Array.isArray(next)) throw new ResolutionError(`"${path}": "${key}" isn't an object or a list`);
    chain.push({ parent: at, key });
    at = next as Obj | unknown[];
  }
  const last = segs[segs.length - 1]!.key;
  if (Array.isArray(at)) {
    const i = at.findIndex((el) => elementMatches(el, last));
    if (value === undefined) { if (i >= 0) at.splice(i, 1); }
    else if (i >= 0) at[i] = value;
    else at.push(value); // theirs kept what ours removed: it comes back at the end of its list
  } else if (value === undefined) {
    delete at[last];
  } else {
    at[last] = value;
  }
  if (value !== undefined) return;
  // Prune the objects the removal emptied, innermost first; never a list, nor the shard's own keys.
  let child: Obj | unknown[] = at;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isObj(child) || Object.keys(child).length > 0) break;
    const { parent, key } = chain[i]!;
    if (Array.isArray(parent)) break; // an element of a list is a record, not sparse storage
    if (parent === root) break; // a shard's own keys (a loc shard's `strings`) are its shape
    delete parent[key];
    child = parent;
  }
}

/**
 * Apply a decision to each named clash of a marked shard, and answer the shard's new canonical text. "ours"
 * keeps the value and clears the entry, "theirs" writes their value at the path and clears it, "resolved"
 * clears it only. The entries no decision names stay; with none left, the `unresolved` key goes.
 *
 * Throws `ResolutionError` for a path the mark doesn't hold, and for "theirs" on a clash that isn't one
 * value (`isSettableClash`). The shard must parse (`parseSource`).
 */
export function applyResolutions(shardText: string, decisions: readonly ResolutionDecision[]): string {
  const shard = parseSource(shardText) as Obj;
  if (!isObj(shard)) throw new ResolutionError("the shard isn't an object");
  const clashes = new Map(unresolvedClashes(shard).map((c) => [c.path, c]));
  const out = structuredClone(shard);
  for (const { path, decision } of decisions) {
    const clash = clashes.get(path);
    if (!clash) throw new ResolutionError(`no unresolved clash at "${path}"`);
    if (decision !== "theirs") continue;
    if (!isSettableClash(clash)) throw new ResolutionError(`the clash at "${path}" (${clash.kind}) isn't one value, so theirs can't be written: keep ours, or edit it and mark it resolved`);
    setAtPath(out, path, structuredClone(clash.theirs));
  }
  return canonicalStringify(clearUnresolved(out, decisions.map((d) => d.path)));
}

/** What a merge's `.patterconflict` sidecar says (merge.ts `MergeResult`, written beside the shard). */
export interface ConflictSidecar {
  type?: string;
  conflicts: Array<{ id?: string; path: string; kind?: string; base?: unknown; ours?: unknown; theirs?: unknown }>;
  warnings: Array<{ id?: string; path: string; message: string }>;
}

/** A shard carrying the `unresolved` mark: where it is, what it holds, its clashes, and its sidecar. */
export interface MarkedShard {
  /** The shard's path (absolute when `root` was). */
  file: string;
  /** The parsed shard, our side of each clash in place. */
  shard: Record<string, unknown>;
  clashes: UnresolvedClash[];
  /** The `.patterconflict` beside it, when there is one that parses. */
  sidecar?: ConflictSidecar;
  /** Where that sidecar is (set whenever the file exists, readable or not). */
  sidecarPath?: string;
}

/**
 * Every shard of the project at `root` that carries the `unresolved` mark, with its clashes and its sidecar:
 * what a resolver lists. The same walk and the same cheap test as validate's `unresolvedMarkIssues` (dot
 * folders skipped, a shard that won't parse left to the loader to report).
 */
export function findMarkedShards(root: string): MarkedShard[] {
  const tree = walkFilesByExt(root, [...SHARD_EXTENSIONS, CONFLICT_SIDECAR]);
  const sidecars = new Set(tree.get(CONFLICT_SIDECAR)!);
  const out: MarkedShard[] = [];
  for (const file of SHARD_EXTENSIONS.flatMap((ext) => tree.get(ext)!).sort()) {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (!text.includes("unresolved")) continue; // the cheap test first: almost no shard has one
    let shard: unknown;
    try { shard = parseSource(text); } catch { continue; }
    if (!isObj(shard) || unresolvedOf(shard) === undefined) continue;
    const found: MarkedShard = { file, shard, clashes: unresolvedClashes(shard) };
    const sidecarPath = `${file}${CONFLICT_SIDECAR}`;
    if (sidecars.has(sidecarPath)) {
      found.sidecarPath = sidecarPath;
      try {
        const s = JSON.parse(readFileSync(sidecarPath, "utf8")) as Partial<ConflictSidecar>;
        found.sidecar = { ...(typeof s.type === "string" ? { type: s.type } : {}), conflicts: Array.isArray(s.conflicts) ? s.conflicts : [], warnings: Array.isArray(s.warnings) ? s.warnings : [] };
      } catch { /* a sidecar that won't read adds no detail */ }
    }
    out.push(found);
  }
  return out;
}
