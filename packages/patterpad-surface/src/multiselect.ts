// ---------------------------------------------------------------------------
// The discontiguous chunk-selection set (groups §6). ProseMirror has no native
// multi-node selection, so a plugin holds the selected chunks' stable model ids
// (plus the shift anchor). Shift-click fills a contiguous run; Cmd/Ctrl-click
// toggles one chunk in / out - so a run like [1,2,3,4] can become [1,2,4]. The
// set is always SIBLINGS under one container (enforced at the gesture, web/chunkselect).
//
// Everything that acts on "the selected chunks" - the decoration, delete, wrap,
// drag, the inspector count, the hint bar - reads `multiSelectPositions` here, the
// single source of truth. The PM selection rides along as a NodeSelection on the
// most-recent chunk (for focus / a valid cursor); the SET is what's multi-selected.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { findByModelId, isChunk, modelIdOf } from "./zoneutil.js";

export interface MultiSelectState {
  /** Selected chunk model-ids (raw.id), in selection order. */
  ids: string[];
  /** The shift anchor chunk id (a further shift-click extends from here). */
  anchor: string | null;
}
const EMPTY: MultiSelectState = { ids: [], anchor: null };

export const multiSelectKey = new PluginKey<MultiSelectState>("patterMultiSelect");
/** Transaction meta carrying the new set (or null to clear). Set ALONGSIDE the selection it mirrors. */
export const SET_MULTI = "patterSetMultiSelect";

/**
 * The selection-set plugin: stores the set, replaced wholesale via the {@link SET_MULTI} meta. ANY
 * other selection change or edit clears it (you moved the caret / typed - the multi-select is gone),
 * so the set never lingers stale behind a normal selection.
 */
export function multiSelectState(): Plugin<MultiSelectState> {
  return new Plugin<MultiSelectState>({
    key: multiSelectKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(SET_MULTI) as MultiSelectState | null | undefined;
        if (meta !== undefined) return meta ?? EMPTY; // the gesture set it (alongside the selection)
        if (tr.selectionSet || tr.docChanged) return EMPTY; // a plain caret move / edit drops the set
        return prev;
      },
    },
  });
}

/** Position before the sibling chunk (snippet|group) whose model id is `id`, or -1. */
export function chunkPosById(doc: PMNode, id: string): number {
  return findByModelId(doc, id, isChunk)?.pos ?? -1;
}

export const multiSelectIds = (state: EditorState): string[] => multiSelectKey.getState(state)?.ids ?? [];
export const multiSelectAnchorId = (state: EditorState): string | null => multiSelectKey.getState(state)?.anchor ?? null;

/**
 * The document positions of the multi-selected chunks (>= 2), sorted ascending - the single source of
 * truth for delete / wrap / drag / decoration / inspector / hints. Returns [] when fewer than two
 * chunks are in the set (a single chunk is an ordinary NodeSelection, not a multi-select).
 */
export function multiSelectPositions(state: EditorState): number[] {
  const ids = multiSelectIds(state);
  if (ids.length < 2) return [];
  // Resolve the whole set in ONE document walk (not one walk per id) - this runs on every decoration
  // render / inspect / hint, so a per-id walk was O(ids · nodes).
  const want = new Set(ids);
  const byId = new Map<string, number>();
  state.doc.descendants((n, pos) => {
    if (isChunk(n)) { const id = modelIdOf(n); if (id != null && want.has(id)) byId.set(id, pos); }
    return true; // chunks nest (choice > option > snippet), so keep descending
  });
  const ps = ids.map((id) => byId.get(id)).filter((p): p is number => p != null).sort((a, b) => a - b);
  return ps.length >= 2 ? ps : [];
}
