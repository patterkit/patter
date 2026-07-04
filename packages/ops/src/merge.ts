// ---------------------------------------------------------------------------
// The domain-aware 3-way merge (patter-merge.md): reconcile Patter source by
// node id, not by line. ONE engine over parsed models; the CLI / editor read
// the files and write the result. Pure - data in, data out, no I/O, no VCS.
//
// M1 covers the two simplest, highest-value shard types (patter-merge.md §7):
//   - LOCALE (`.patterloc`): a flat beatId -> text map, per-key 3-way (§3.3).
//   - AUTHORING (`.patterx`): comments union, status last-writer-wins by edit
//     timestamp, documentation 3-way, edits newer-record + localisedAt max,
//     cut per-key (§3.4).
// FLOW and PROJECT mergers are M2; runMerge throws `UnsupportedMergeError` for
// them so a caller never silently mis-merges.
//
// The merged model is ALWAYS valid canonical source; conflicted values resolve
// provisionally to OURS and are listed separately (§3.6), for a sidecar a UI
// can render. Equality is deep + key-order-independent (canonical bytes).
// ---------------------------------------------------------------------------

import { canonicalStringify } from "@patterkit/core";

export type MergeFileType = "flow" | "loc" | "authoring" | "project";

export type ConflictKind =
  | "both-changed"      // both sides changed the same value differently
  | "delete-vs-edit"    // one side deleted a node, the other edited it
  | "no-timestamp"      // status diverged with no edit clock to break the tie
  | "moved"             // a node reordered to incompatible positions on both sides
  | "added-both"        // the same id added on both sides with different content
  | "structural";       // a post-merge validation failure (e.g. a duplicate id)

/** One unresolved 3-way conflict; provisional output is OURS. */
export interface Conflict {
  /** The unit id (beat/node/comment/scene id or planned name); "" for a file-level field. */
  id: string;
  /** Dotted path within the file, e.g. `strings.L_1` or `writing.L_1`. */
  path: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  kind: ConflictKind;
}

/** A non-blocking note - the merge proceeded, but a human may want to check. */
export interface Warning {
  id: string;
  path: string;
  message: string;
}

export interface MergeResult {
  type: MergeFileType;
  /** The merged model - valid canonical source; conflicts resolved to OURS. */
  merged: Record<string, unknown>;
  conflicts: Conflict[];
  /** Advisory notes (e.g. both sides inserted at the same anchor, kept ours-then-theirs). */
  warnings: Warning[];
}

/** Thrown when asked to merge a type M1 does not handle yet (flow / project). */
export class UnsupportedMergeError extends Error {}

type Obj = Record<string, unknown>;

const eq = (a: unknown, b: unknown): boolean => canonicalStringify(a) === canonicalStringify(b);
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Detect the merge type from a file's `schema` tag. */
export function detectMergeType(file: { schema?: unknown }): MergeFileType {
  const s = typeof file.schema === "string" ? file.schema : "";
  if (s.startsWith("patter/flow")) return "flow";
  if (s.startsWith("patter/strings")) return "loc";
  if (s.startsWith("patter/authoring")) return "authoring";
  if (s.startsWith("patter/project")) return "project";
  throw new UnsupportedMergeError(`cannot detect a Patter merge type from schema '${s}'`);
}

/** 3-way merge BASE / OURS / THEIRS (parsed models). Dispatches by file type. */
export function runMerge(base: Obj, ours: Obj, theirs: Obj, opts?: { type?: MergeFileType }): MergeResult {
  const type = opts?.type ?? detectMergeType(ours);
  switch (type) {
    case "loc": return mergeLoc(base, ours, theirs);
    case "authoring": return mergeAuthoring(base, ours, theirs);
    case "flow": return mergeFlow(base, ours, theirs);
    case "project": return mergeProject(base, ours, theirs);
  }
}

// --- 3-way primitives --------------------------------------------------------

function deletedKind(base: unknown, ours: unknown, theirs: unknown): ConflictKind {
  const deleted = base !== undefined && (ours === undefined || theirs === undefined);
  return deleted ? "delete-vs-edit" : "both-changed";
}

/** Standard 3-way of a single value; pushes a conflict (provisional OURS) when both diverge. */
function merge3(base: unknown, ours: unknown, theirs: unknown, id: string, path: string, conflicts: Conflict[]): unknown {
  if (eq(ours, theirs)) return ours;     // identical (incl. both added / both deleted the same)
  if (eq(base, ours)) return theirs;     // only THEIRS changed
  if (eq(base, theirs)) return ours;     // only OURS changed
  conflicts.push({ id, path, base, ours, theirs, kind: deletedKind(base, ours, theirs) });
  return ours;
}

/** When both sides change a key differently, a resolver may break the tie (e.g. LWW). */
type Resolver = (id: string, base: unknown, ours: unknown, theirs: unknown) =>
  { resolved: true; value: unknown } | { resolved: false; kind: ConflictKind };

/** Per-key 3-way over the union of keys of three maps. Absent key = deleted. */
function mergeMap(base: Obj, ours: Obj, theirs: Obj, prefix: string, conflicts: Conflict[], resolve?: Resolver): Obj {
  const out: Obj = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const b = base[k], o = ours[k], t = theirs[k];
    let v: unknown;
    if (eq(o, t)) v = o;
    else if (eq(b, o)) v = t;
    else if (eq(b, t)) v = o;
    else {
      const r = resolve?.(k, b, o, t);
      if (r && r.resolved) v = r.value;
      else { conflicts.push({ id: k, path: `${prefix}.${k}`, base: b, ours: o, theirs: t, kind: r ? r.kind : deletedKind(b, o, t) }); v = o; }
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const asMap = (v: unknown): Obj => (isObj(v) ? v : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Set `key` only when the value carries content - keeps canonical output clean. */
function setIf(obj: Obj, key: string, val: Obj | unknown[]): void {
  if (Array.isArray(val) ? val.length > 0 : Object.keys(val).length > 0) obj[key] = val;
}

// --- Locale (`.patterloc`) ---------------------------------------------------

function mergeLoc(base: Obj, ours: Obj, theirs: Obj): MergeResult {
  const conflicts: Conflict[] = [];
  const merged: Obj = {};
  for (const f of ["schema", "scene", "locale", "default"]) {
    const v = merge3(base[f], ours[f], theirs[f], "", f, conflicts);
    if (v !== undefined) merged[f] = v;
  }
  merged.strings = mergeMap(asMap(base.strings), asMap(ours.strings), asMap(theirs.strings), "strings", conflicts);
  return { type: "loc", merged, conflicts, warnings: [] };
}

// --- Authoring (`.patterx`) --------------------------------------------------

function mergeAuthoring(base: Obj, ours: Obj, theirs: Obj): MergeResult {
  const conflicts: Conflict[] = [];
  const merged: Obj = {};
  merged.schema = merge3(base.schema, ours.schema, theirs.schema, "", "schema", conflicts) ?? ours.schema;

  // Comments: append-only union by id (immutable records) - never conflicts.
  setIf(merged, "comments", mergeComments(asArr(base.comments), asArr(ours.comments), asArr(theirs.comments)));

  // Edits merge first: it is the clock the status LWW reads. Deterministic.
  const edits = mergeEdits(asMap(base.edits), asMap(ours.edits), asMap(theirs.edits));
  setIf(merged, "edits", edits);

  // Writing / recording / audio: last-writer-wins per (id), clocked by each
  // side's own edits[id].modifiedAt; no timestamp -> conflict.
  const lww = lastWriterWins(asMap(ours.edits), asMap(theirs.edits));
  for (const f of ["writing", "recording", "audio"]) {
    setIf(merged, f, mergeMap(asMap(base[f]), asMap(ours[f]), asMap(theirs[f]), f, conflicts, lww));
  }

  // Documentation: content - plain 3-way per node id.
  setIf(merged, "documentation", mergeMap(asMap(base.documentation), asMap(ours.documentation), asMap(theirs.documentation), "documentation", conflicts));

  // Cut: per-key 3-way.
  setIf(merged, "cut", mergeMap(asMap(base.cut), asMap(ours.cut), asMap(theirs.cut), "cut", conflicts, undefined));

  return { type: "authoring", merged, conflicts, warnings: [] };
}

function mergeComments(base: unknown[], ours: unknown[], theirs: unknown[]): unknown[] {
  const byId = new Map<string, Obj>();
  for (const c of [...base, ...ours, ...theirs]) {
    if (isObj(c) && typeof c.id === "string" && !byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
}

function lastWriterWins(oursEdits: Obj, theirsEdits: Obj): Resolver {
  return (id, _b, o, t) => {
    const om = (asMap(oursEdits[id]).modifiedAt), tm = (asMap(theirsEdits[id]).modifiedAt);
    if (typeof om === "string" && typeof tm === "string") return { resolved: true, value: om >= tm ? o : t };
    return { resolved: false, kind: "no-timestamp" };
  };
}

function mergeEdits(base: Obj, ours: Obj, theirs: Obj): Obj {
  const out: Obj = {};
  for (const id of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const o = ours[id], t = theirs[id];
    if (eq(o, t)) { if (o !== undefined) out[id] = o; continue; }
    if (o === undefined) { if (t !== undefined) out[id] = t; continue; }
    if (t === undefined) { out[id] = o; continue; }
    out[id] = mergeEditRecord(asMap(o), asMap(t));
  }
  return out;
}

/** Take the newer record (by modifiedAt), then merge localisedAt per-locale by max. */
function mergeEditRecord(o: Obj, t: Obj): Obj {
  const om = typeof o.modifiedAt === "string" ? o.modifiedAt : "";
  const tm = typeof t.modifiedAt === "string" ? t.modifiedAt : "";
  const newer = om >= tm ? o : t;
  const ol = asMap(o.localisedAt), tl = asMap(t.localisedAt);
  const loc: Obj = {};
  for (const k of new Set([...Object.keys(ol), ...Object.keys(tl)])) {
    const a = typeof ol[k] === "string" ? (ol[k] as string) : "";
    const b = typeof tl[k] === "string" ? (tl[k] as string) : "";
    loc[k] = a >= b ? (ol[k] ?? tl[k]) : (tl[k] ?? ol[k]);
  }
  const merged: Obj = { ...newer };
  if (Object.keys(loc).length > 0) merged.localisedAt = loc;
  return merged;
}

/** Merge a `name`-keyed array (properties / cast): per-name 3-way, sorted by name. */
function mergeKeyedByName(base: unknown[], ours: unknown[], theirs: unknown[], path: string, conflicts: Conflict[]): unknown[] {
  const byName = (arr: unknown[]): Obj => {
    const m: Obj = {};
    for (const p of arr) if (isObj(p) && typeof p.name === "string") m[p.name] = p;
    return m;
  };
  const merged = mergeMap(byName(base), byName(ours), byName(theirs), path, conflicts);
  return Object.keys(merged).sort().map((name) => merged[name]);
}

// --- Project (`.patterproj`) -------------------------------------------------

function mergeProject(base: Obj, ours: Obj, theirs: Obj): MergeResult {
  const conflicts: Conflict[] = [];
  const merged: Obj = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    if (k === "properties" || k === "cast") {
      const v = mergeKeyedByName(asArr(base[k]), asArr(ours[k]), asArr(theirs[k]), k, conflicts);
      if (v.length > 0) merged[k] = v;
    } else if (k === "gameDataFields") {
      // A per-node-type record of name-keyed field arrays; merge each node type's array independently.
      const v = mergeGameDataFields(asMap(base[k]), asMap(ours[k]), asMap(theirs[k]), conflicts);
      if (Object.keys(v).length > 0) merged[k] = v;
    } else if (k === "locales") {
      merged.locales = mergeLocales(asMap(base.locales), asMap(ours.locales), asMap(theirs.locales), conflicts);
    } else {
      const v = merge3(base[k], ours[k], theirs[k], "", k, conflicts);
      if (v !== undefined) merged[k] = v;
    }
  }
  return { type: "project", merged, conflicts, warnings: [] };
}

/** gameDataFields: a record of node-type -> name-keyed field array. Merge each node type's array on its
 *  own (a field is identified by its `name` within its node type), 3-way like properties / cast. */
function mergeGameDataFields(b: Obj, o: Obj, t: Obj, conflicts: Conflict[]): Obj {
  const out: Obj = {};
  for (const kind of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const v = mergeKeyedByName(asArr(b[kind]), asArr(o[kind]), asArr(t[kind]), `gameDataFields.${kind}`, conflicts);
    if (v.length > 0) out[kind] = v;
  }
  return out;
}

/** locales: `default` is a scalar 3-way; `all` is a set union (preserving first-seen order). */
function mergeLocales(b: Obj, o: Obj, t: Obj, conflicts: Conflict[]): Obj {
  const out: Obj = {};
  const def = merge3(b.default, o.default, t.default, "", "locales.default", conflicts);
  if (def !== undefined) out.default = def;
  const all: string[] = [];
  for (const arr of [asArr(b.all), asArr(o.all), asArr(t.all)]) {
    for (const x of arr) if (typeof x === "string" && !all.includes(x)) all.push(x);
  }
  out.all = all;
  return out;
}

// --- Flow (`.patterflow`) - the id-keyed tree merge --------------------------
//
// A node is anything with an `id`; each carries scalar FIELDS and at most one
// ordered CHILD container (`blocks` / `children` / `beats`). The merge is
// recursive: per-node fields 3-way, and per-container an ordered-list merge by
// id. Reparenting (a node moving between containers) decomposes to delete+add
// here - safe (a contended move surfaces as delete-vs-edit), full move-tracking
// is a later refinement. A post-merge duplicate-id sweep is demoted to a
// conflict so a structurally broken tree can never land silently (§3.2).

const CHILD_KEYS = ["blocks", "children", "beats"] as const;

interface TNode { id: string; fields: Obj; childKey?: string; children: TNode[]; }

function toTree(raw: Obj): TNode {
  const childKey = CHILD_KEYS.find((k) => Array.isArray(raw[k]));
  const fields: Obj = {};
  for (const [k, v] of Object.entries(raw)) if (k !== childKey) fields[k] = v;
  const children = childKey ? (raw[childKey] as unknown[]).filter(isObj).map(toTree) : [];
  return { id: typeof raw.id === "string" ? raw.id : "", fields, childKey, children };
}

function fromTree(n: TNode): Obj {
  const out: Obj = { ...n.fields };
  if (n.childKey) out[n.childKey] = n.children.map(fromTree);
  return out;
}

function mergeFlow(base: Obj, ours: Obj, theirs: Obj): MergeResult {
  const conflicts: Conflict[] = [];
  const warnings: Warning[] = [];
  const merged: Obj = {};
  merged.schema = merge3(base.schema, ours.schema, theirs.schema, "", "schema", conflicts) ?? ours.schema;

  const bScene = isObj(base.scene) ? toTree(base.scene) : undefined;
  const oScene = toTree(asMap(ours.scene));
  const tScene = isObj(theirs.scene) ? toTree(theirs.scene) : undefined;
  const mergedScene = mergeNode(bScene, oScene, tScene, "scene", conflicts, warnings);
  merged.scene = fromTree(mergedScene);

  checkDuplicateIds(mergedScene, conflicts);
  return { type: "flow", merged, conflicts, warnings };
}

/** Merge one node present in OURS (and maybe BASE/THEIRS): fields 3-way + children. */
function mergeNode(b: TNode | undefined, o: TNode, t: TNode | undefined, path: string, conflicts: Conflict[], warnings: Warning[]): TNode {
  const fields = mergeFields(b?.fields ?? {}, o.fields, t?.fields ?? {}, o.id, path, conflicts);
  const childKey = o.childKey ?? t?.childKey ?? b?.childKey;
  const children = childKey
    ? mergeChildren(b?.children ?? [], o.children, t?.children ?? [], `${path}.${childKey}`, conflicts, warnings)
    : [];
  return { id: o.id, fields, childKey, children };
}

function mergeFields(b: Obj, o: Obj, t: Obj, id: string, path: string, conflicts: Conflict[]): Obj {
  const out: Obj = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const v = merge3(b[k], o[k], t[k], id, `${path}.${k}`, conflicts);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** The ordered-list merge with identity (§3.2): survival + content, then order. */
function mergeChildren(B: TNode[], O: TNode[], T: TNode[], path: string, conflicts: Conflict[], warnings: Warning[]): TNode[] {
  const Bm = idMap(B), Om = idMap(O), Tm = idMap(T);
  const Bset = new Set(Bm.keys()), Oset = new Set(Om.keys()), Tset = new Set(Tm.keys());
  const merged = new Map<string, TNode>();
  const here = (id: string) => `${path}[${id}]`;

  for (const id of new Set([...Bm.keys(), ...Om.keys(), ...Tm.keys()])) {
    const b = Bm.get(id), o = Om.get(id), t = Tm.get(id);
    const inB = Bset.has(id), inO = Oset.has(id), inT = Tset.has(id);
    if (inO && inT) {
      if (!inB && !eq(fromTree(o!), fromTree(t!))) {
        conflicts.push({ id, path: here(id), base: undefined, ours: fromTree(o!), theirs: fromTree(t!), kind: "added-both" });
        merged.set(id, o!); // provisional OURS
      } else {
        merged.set(id, mergeNode(b, o!, t, here(id), conflicts, warnings));
      }
    } else if (inO && !inT) {
      if (inB && !eq(fromTree(o!), fromTree(b!))) {
        conflicts.push({ id, path: here(id), base: fromTree(b!), ours: fromTree(o!), theirs: undefined, kind: "delete-vs-edit" });
        merged.set(id, o!); // theirs deleted, ours edited -> provisional OURS keeps it
      } else if (!inB) {
        merged.set(id, o!); // ours inserted
      } // else: ours unchanged + theirs deleted -> clean delete
    } else if (!inO && inT) {
      if (inB && !eq(fromTree(t!), fromTree(b!))) {
        conflicts.push({ id, path: here(id), base: fromTree(b!), ours: undefined, theirs: fromTree(t!), kind: "delete-vs-edit" });
        // ours deleted -> provisional OURS drops it (still flagged)
      } else if (!inB) {
        merged.set(id, t!); // theirs inserted
      } // else: theirs unchanged + ours deleted -> clean delete
    } // else: in BASE only -> both deleted -> gone
  }

  return orderChildren(merged, B, O, T, path, conflicts, warnings);
}

/** Order the surviving children: 3-way the common (base) order, then weave inserts at anchors. */
function orderChildren(merged: Map<string, TNode>, B: TNode[], O: TNode[], T: TNode[], path: string, conflicts: Conflict[], warnings: Warning[]): TNode[] {
  const Bids = B.map((n) => n.id), Oids = O.map((n) => n.id), Tids = T.map((n) => n.id);
  const Oidset = new Set(Oids); // O(1) "does ours have this id" - avoids an O(n) scan inside the theirs loop
  const common = new Set(Bids.filter((id) => merged.has(id)));
  const restrict = (ids: string[]) => ids.filter((id) => common.has(id));
  const relB = restrict(Bids), relO = restrict(Oids), relT = restrict(Tids);
  // A side that DELETED a common survivor (kept via a delete-vs-edit conflict)
  // lacks it in its sequence - its order can't drive the full set.
  const fullO = relO.length === common.size, fullT = relT.length === common.size;

  let commonOrder: string[];
  if (!fullO && !fullT) commonOrder = relB;             // both dropped a survivor -> base skeleton
  else if (!fullO) commonOrder = relT;                  // ours dropped one -> use theirs (has the full set)
  else if (!fullT) commonOrder = relO;                  // theirs dropped one -> use ours
  else if (arrEq(relO, relB)) commonOrder = relT;       // only theirs reordered
  else if (arrEq(relT, relB)) commonOrder = relO;       // only ours reordered
  else if (arrEq(relO, relT)) commonOrder = relO;       // same reorder
  else { conflicts.push({ id: "", path, base: relB, ours: relO, theirs: relT, kind: "moved" }); commonOrder = relO; }

  // Inserts (survivors not in base): anchored to the nearest preceding common id in their source list.
  const anchorIn = (ids: string[], id: string): string | null => {
    for (let i = ids.indexOf(id) - 1; i >= 0; i--) if (common.has(ids[i]!)) return ids[i]!;
    return null;
  };
  type Group = { ours: string[]; theirs: string[] };
  const byAnchor = new Map<string | null, Group>();
  const group = (a: string | null): Group => { let g = byAnchor.get(a); if (!g) { g = { ours: [], theirs: [] }; byAnchor.set(a, g); } return g; };
  for (const n of O) if (merged.has(n.id) && !common.has(n.id)) group(anchorIn(Oids, n.id)).ours.push(n.id);
  for (const n of T) if (merged.has(n.id) && !common.has(n.id) && !Oidset.has(n.id)) group(anchorIn(Tids, n.id)).theirs.push(n.id);

  const out: string[] = [];
  const emit = (anchor: string | null) => {
    const g = byAnchor.get(anchor);
    if (!g) return;
    if (g.ours.length > 0 && g.theirs.length > 0) warnings.push({ id: anchor ?? "", path, message: "both sides inserted here; kept ours-then-theirs - review the order" });
    out.push(...g.ours, ...g.theirs);
  };
  emit(null);
  for (const id of commonOrder) { out.push(id); emit(id); }

  return out.map((id) => merged.get(id)!);
}

function checkDuplicateIds(root: TNode, conflicts: Conflict[]): void {
  const seen = new Set<string>(), dup = new Set<string>();
  const walk = (n: TNode) => { if (n.id) { if (seen.has(n.id)) dup.add(n.id); else seen.add(n.id); } n.children.forEach(walk); };
  walk(root);
  for (const id of dup) conflicts.push({ id, path: "scene", base: undefined, ours: undefined, theirs: undefined, kind: "structural" });
}

const idMap = (nodes: TNode[]): Map<string, TNode> => new Map(nodes.filter((n) => n.id).map((n) => [n.id, n]));
const arrEq = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
