// Selecting chunks (snippet / group) by pointer - shared by every grab affordance (the bubble's
// border, the jump chip, the drag grip). Three gestures, all within ONE container (groups §6):
//   plain click  - select just this chunk (a NodeSelection; clears any multi-set).
//   Shift-click  - extend a CONTIGUOUS run from the anchor chunk through this one.
//   Cmd/Ctrl-click - TOGGLE this chunk in / out of the set (so [1,2,3,4] can become [1,2,4]).
// The multi-set lives in the multiSelect plugin (src/multiselect); the PM selection rides along as a
// NodeSelection on the most-recent chunk. A click in a DIFFERENT container starts fresh - the set is
// always siblings under one parent.

import { NodeSelection, Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { chunkContaining } from "../src/groups.js";
import { multiSelectIds, multiSelectAnchorId, chunkPosById, SET_MULTI } from "../src/multiselect.js";
import { isChunk, modelIdOf } from "../src/zoneutil.js";

const idAt = (doc: PMNode, pos: number): string | null => {
  const n = doc.nodeAt(pos);
  return n && isChunk(n) ? modelIdOf(n) : null;
};
const sameParent = (doc: PMNode, a: number, b: number): boolean => {
  try { return doc.resolve(a).parent === doc.resolve(b).parent; } catch { return false; }
};

/** The chunk ids of the contiguous sibling run from the chunk at `posA` through `posB` (inclusive). */
function runIds(doc: PMNode, posA: number, posB: number): string[] {
  const $a = doc.resolve(posA), $b = doc.resolve(posB);
  if ($a.parent !== $b.parent || $a.depth !== $b.depth) return [];
  const [lo, hi] = $a.index() <= $b.index() ? [$a.index(), $b.index()] : [$b.index(), $a.index()];
  const ids: string[] = [];
  for (let i = lo; i <= hi; i++) {
    const c = $a.parent.child(i);
    const id = isChunk(c) ? modelIdOf(c) : null;
    if (id) ids.push(id);
  }
  return ids;
}

export interface SelectMods { shift?: boolean; toggle?: boolean }

/** Apply a pointer chunk-selection (plain / shift-run / cmd-toggle). See the module header. */
export function selectChunkAt(view: EditorView, pos: number, mods: SelectMods = {}): void {
  const doc = view.state.doc;
  const clickedId = idAt(doc, pos);
  if (clickedId == null) return; // not a chunk

  // The current set: the plugin's, or - if it's empty but a single chunk is node-selected - that one.
  let curIds = multiSelectIds(view.state);
  if (curIds.length === 0) {
    const sel = view.state.selection;
    if (sel instanceof NodeSelection && CHUNK.has(sel.node.type.name)) { const id = idAt(doc, sel.from); if (id) curIds = [id]; }
  }
  const anchorId = multiSelectAnchorId(view.state) ?? curIds[0] ?? null;

  /** Node-select `primaryPos` and store the set (or clear it when < 2 chunks remain). */
  const commit = (ids: string[], anchor: string | null, primaryPos: number): void => {
    const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, primaryPos));
    tr.setMeta(SET_MULTI, ids.length >= 2 ? { ids, anchor } : null);
    view.dispatch(tr); view.focus();
  };
  /** Drop the multi-select entirely: a caret inside the chunk at `pos`. */
  const collapse = (): void => { view.dispatch(view.state.tr.setSelection(Selection.near(doc.resolve(pos))).setMeta(SET_MULTI, null)); view.focus(); };

  if (mods.toggle) {
    const setParentPos = curIds.length ? chunkPosById(doc, curIds[0]!) : -1;
    // A toggle in a DIFFERENT container starts fresh - never add a chunk from another list.
    if (curIds.length && setParentPos >= 0 && !sameParent(doc, setParentPos, pos)) { commit([clickedId], clickedId, pos); return; }
    const ids = curIds.includes(clickedId) ? curIds.filter((id) => id !== clickedId) : [...curIds, clickedId];
    if (ids.length === 0) { collapse(); return; }
    const primaryId = ids.includes(clickedId) ? clickedId : ids[ids.length - 1]!;
    commit(ids, anchorId ?? ids[0]!, chunkPosById(doc, primaryId));
    return;
  }

  if (mods.shift) {
    if (curIds.length === 1 && curIds[0] === clickedId) { collapse(); return; } // shift the sole one off
    const aPos = anchorId ? chunkPosById(doc, anchorId)
      : view.state.selection instanceof NodeSelection ? view.state.selection.from : chunkContaining(doc, view.state.selection.anchor);
    if (aPos != null && aPos >= 0 && sameParent(doc, aPos, pos)) {
      const ids = runIds(doc, aPos, pos);
      if (ids.length >= 2) { commit(ids, idAt(doc, aPos)!, pos); return; }
    }
    // fall through to a plain select when there's no valid sibling run
  }

  commit([clickedId], clickedId, pos);
}
