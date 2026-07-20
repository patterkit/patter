// ---------------------------------------------------------------------------
// Duplicate a whole chunk - a block, a group, or a snippet - WITH its children.
//
// Every node in the copy gets a FRESH id. An id is the node's identity (locale
// keys, jump targets, audio filenames, save data and the edit trail all key on
// it), so a copied id would alias the original and two nodes would share one
// line of text. Ids live in two places (see bridge.ts): a beat keeps its id in a
// real `id` attr, while a block / group / snippet keeps its id inside the `raw`
// JSON overlay; an unmodeled chunk rides as a whole JSON subtree in `json`. All
// three are regenerated here.
//
// Beat TEXT needs no special handling: it lives in the doc (the `say` zone), so
// it clones with the node and docToScene writes fresh locale strings under the
// new beat ids. The old -> new id map is returned so the HOST can carry the
// sidecar authoring metadata across (status, notes) - see setDuplicateHandler.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { newId } from "@patterkit/core";

/** old id -> new id for every node in a duplicated subtree. */
export type IdMap = Record<string, string>;

type DuplicateFn = (idMap: IdMap) => void;
let duplicateHandler: DuplicateFn | null = null;
/** The HOST owns the sidecar authoring metadata (writing / recording status, VO notes), all keyed by
 *  node id, so it needs the map to carry it from the originals to the copies. Threaded review COMMENTS
 *  are deliberately NOT carried - they are a conversation about the original line, not about its copy.
 *  (Tags need no handler: they live on the node itself and ride across in `raw`.) */
export function setDuplicateHandler(fn: DuplicateFn | null): void { duplicateHandler = fn; }
/** Tell the host a subtree was duplicated, so it can carry the metadata across. */
export function notifyDuplicated(idMap: IdMap): void { if (Object.keys(idMap).length) duplicateHandler?.(idMap); }

/** The chunk kinds that can be duplicated (a beat duplicates as part of its snippet). */
export const DUPLICABLE_KINDS: ReadonlySet<string> = new Set(["block", "group", "snippet", "rawnode"]);

/** The house id prefix for a node kind, used when the original id carries none (see freshId). An OPTION
 *  group is only distinguishable by its `opt_` prefix, so it is preserved rather than defaulted. */
const PREFIX_FOR: Record<string, string> = {
  block: "blk", group: "g", snippet: "sn", line: "L", prose: "L", gameEvent: "A",
};

/** Mint a fresh id keeping the original's type prefix (`sn_ab12` -> `sn_zx98`). An id with no prefix
 *  (hand-written / legacy) takes the house one for its node kind, so a copy is always well-formed. */
function freshId(old: string, kind?: string): string {
  const cut = old.indexOf("_");
  if (cut > 0) return newId(old.slice(0, cut));
  return newId((kind && PREFIX_FOR[kind]) || "");
}

function parseObj(json: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Regenerate every `id` inside an arbitrary JSON subtree (an unmodeled chunk we cannot type). */
function regenJsonIds(value: unknown, map: IdMap): unknown {
  if (Array.isArray(value)) return value.map((v) => regenJsonIds(v, map));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "id" && typeof v === "string" && v) { const next = freshId(v); map[v] = next; out[k] = next; }
      else out[k] = regenJsonIds(v, map);
    }
    return out;
  }
  return value;
}

/** Every block name currently in the doc - a copy must not reuse one (see copyName). */
function blockNames(doc: PMNode): Set<string> {
  const names = new Set<string>();
  doc.forEach((b) => {
    const raw = typeof b.attrs.raw === "string" ? parseObj(b.attrs.raw) : null;
    if (raw && typeof raw.name === "string") names.add(raw.name);
  });
  return names;
}

/**
 * "Main" -> "Main copy", then "Main copy 2", "Main copy 3"... A block's host-facing address falls back
 * to a slug of its NAME (model `effectiveGameId`) and block addresses must be unique within the scene,
 * so a same-named copy would be an immediate `duplicate-gameid` validation error.
 */
export function copyName(base: string, taken: Set<string>): string {
  const first = `${base} copy`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${first} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Deep-clone `node`, minting a fresh id for it and every descendant (recording them in `map`). */
function cloneWithNewIds(node: PMNode, map: IdMap, blockTaken: Set<string> | null): PMNode {
  const attrs: Record<string, unknown> = { ...node.attrs };

  // A beat keeps its id in a real attr.
  if (typeof node.attrs.id === "string" && node.attrs.id) {
    const next = freshId(node.attrs.id, node.type.name);
    map[node.attrs.id] = next;
    attrs.id = next;
  }

  // A block / group / snippet keeps its id (and its unmodeled fields) in the `raw` overlay.
  if (typeof node.attrs.raw === "string") {
    const raw = parseObj(node.attrs.raw);
    if (raw) {
      if (typeof raw.id === "string" && raw.id) {
        const next = freshId(raw.id, node.type.name);
        map[raw.id] = next;
        raw.id = next;
      }
      if (node.type.name === "block" && blockTaken) {
        const base = typeof raw.name === "string" && raw.name.trim() ? raw.name : "Section";
        raw.name = copyName(base, blockTaken);
        delete raw.gameId; // a pinned address is unique by contract - let the copy derive one from its new name
      }
      attrs.raw = JSON.stringify(raw);
    }
  }

  // An unmodeled chunk: the whole node rides as JSON, so regenerate the ids inside it too.
  if (typeof node.attrs.json === "string") {
    const raw = parseObj(node.attrs.json);
    if (raw) attrs.json = JSON.stringify(regenJsonIds(raw, map));
  }

  const kids: PMNode[] = [];
  node.content.forEach((child) => kids.push(child.isText ? child : cloneWithNewIds(child, map, null)));
  return node.type.create(attrs, kids.length ? kids : null, node.marks);
}

/**
 * Duplicate the chunk at `pos`, inserting the copy as its next sibling. Returns the transaction and the
 * old -> new id map (empty-handed when `pos` is not a duplicable chunk).
 */
export function duplicateChunk(state: EditorState, pos: number): { tr: Transaction; idMap: IdMap } | null {
  const node = state.doc.nodeAt(pos);
  if (!node || !DUPLICABLE_KINDS.has(node.type.name)) return null;
  const idMap: IdMap = {};
  const copy = cloneWithNewIds(node, idMap, node.type.name === "block" ? blockNames(state.doc) : null);
  const tr = state.tr.insert(pos + node.nodeSize, copy);
  return { tr, idMap };
}
