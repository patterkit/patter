// Moving a snippet or group up or down among its siblings from the keyboard (the hands-on fixes review,
// Q14): Ctrl+Cmd+Up / Down on a Mac, Ctrl+Alt+Up / Down elsewhere, the ⋯ menu's Move up / Move down, and
// the handle's `moveSelection` for the host's Edit menu all come here.
//
// What moves: the multi-selected chunks when there's a set (they move together if they're neighbours,
// otherwise nothing moves and the author is told why), else the selected snippet, group or block, else the
// snippet holding the caret. It swaps with its neighbour in the same parent and stops at the first or last
// place there: a snippet never climbs out of its group, and never past an option's prompt. Each move is one
// step in the history, however quickly the moves follow each other.

import { NodeSelection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { STRUCTURAL_MOVE, chunkContaining } from "../src/groups.js";
import { ALLOW_STRUCTURE } from "../src/guard.js";
import { SET_MULTI, multiSelectIds, multiSelectAnchorId, multiSelectPositions } from "../src/multiselect.js";
import { isChunk, isChoiceGroup } from "../src/zoneutil.js";
import { keyLabel, keyPlatform } from "@wildwinter/app-shell";

export type MoveDir = -1 | 1;
export type MovePlan = { tr: Transaction } | { refuse: string };

/** Said when a multi-selection has gaps: only neighbours move as one. */
export const NOT_CONTIGUOUS = "Only neighbouring snippets can move together. Select a run with no gaps.";
/** Said when nothing is selected and the caret isn't in a snippet. */
export const NOTHING_TO_MOVE = "Put the caret in a snippet, or select one, to move it.";

/** The portable combo for a move (for `keyLabel` / `keyHint`): Ctrl+Cmd on a Mac, Ctrl+Alt elsewhere. */
export const moveCombo = (dir: MoveDir): string => `${keyPlatform() === "mac" ? "Ctrl+Mod" : "Ctrl+Alt"}+${dir < 0 ? "Up" : "Down"}`;
/** The shortcut as the platform spells it ("⌃⌘↑" on a Mac, "Ctrl+Alt+Up" elsewhere), for menus. */
export const moveShortcutLabel = (dir: MoveDir): string => keyLabel(moveCombo(dir));

/** Is this keydown a move? Read per platform, because ProseMirror's "Mod" can't say Ctrl+Cmd. */
export function moveKeyDir(e: KeyboardEvent): MoveDir | null {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return null;
  if (e.shiftKey) return null;
  const mac = keyPlatform() === "mac";
  const mods = mac ? e.ctrlKey && e.metaKey && !e.altKey : e.ctrlKey && e.altKey && !e.metaKey;
  return mods ? (e.key === "ArrowUp" ? -1 : 1) : null;
}

const movable = (n: PMNode | null | undefined): n is PMNode => !!n && (isChunk(n) || n.type.name === "block");

/** What the current selection would move: the multi-selected set, a selected chunk or block, or the
 *  snippet holding the caret. Empty when there's nothing. */
export function movePositions(state: EditorState): number[] {
  const set = multiSelectPositions(state);
  if (set.length >= 2) return set;
  const sel = state.selection;
  if (sel instanceof NodeSelection && movable(sel.node)) return [sel.from];
  const at = chunkContaining(state.doc, sel.head);
  return at == null ? [] : [at];
}

/** The parent's name in a hint: "block", "group", "choice", "option", or "scene". */
function placeName(state: EditorState, pos: number): string {
  const $p = state.doc.resolve(pos);
  const parent = $p.parent;
  if (parent.type.name === "doc") return "scene";
  if (parent.type.name === "block") return "block";
  if (isChoiceGroup(parent)) return "choice";
  if ($p.depth >= 2 && isChoiceGroup($p.node($p.depth - 1))) return "option";
  return "group";
}

/** Plan moving the nodes at `positions` (sorted or not) one place up (-1) or down (1). */
export function planMove(state: EditorState, positions: readonly number[], dir: MoveDir): MovePlan {
  if (!positions.length) return { refuse: NOTHING_TO_MOVE };
  const sorted = [...positions].sort((a, b) => a - b);
  const nodes = sorted.map((p) => state.doc.nodeAt(p));
  if (!nodes.every(movable)) return { refuse: NOTHING_TO_MOVE };
  const list = nodes as PMNode[];
  const isBlock = list[0]!.type.name === "block";
  if (list.some((n) => (n.type.name === "block") !== isBlock)) return { refuse: NOT_CONTIGUOUS };
  // Neighbours: each one starts where the one before it ends (which also means the same parent).
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]! + list[i - 1]!.nodeSize) return { refuse: NOT_CONTIGUOUS };
  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]! + list[list.length - 1]!.nodeSize;
  const $start = state.doc.resolve(start);
  const parent = $start.parent;
  const first = $start.index();
  const nbIndex = dir < 0 ? first - 1 : first + list.length;
  const nb = nbIndex >= 0 && nbIndex < parent.childCount ? parent.child(nbIndex) : null;
  const fits = nb && (isBlock ? nb.type.name === "block" : isChunk(nb));
  if (!fits) {
    const who = list.length > 1 ? "They're" : "It's";
    return { refuse: `${who} already ${dir < 0 ? "at the top" : "at the bottom"} of this ${placeName(state, start)}.` };
  }
  const runSize = end - start;
  const tr = state.tr;
  let newStart: number, nbFrom: number, nbDelta: number;
  if (dir < 0) {
    nbFrom = start - nb.nodeSize;
    tr.replaceWith(nbFrom, end, [...list, nb]);
    newStart = nbFrom; nbDelta = runSize;
  } else {
    nbFrom = end;
    tr.replaceWith(start, end + nb.nodeSize, [nb, ...list]);
    newStart = start + nb.nodeSize; nbDelta = -runSize;
  }
  const delta = newStart - start;
  // The selection rides with whatever it was in: the moved run, or the neighbour that traded places.
  const shift = (x: number): number => (x >= start && x <= end ? x + delta : x >= nbFrom && x <= nbFrom + nb.nodeSize ? x + nbDelta : x);
  const sel = state.selection;
  if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, shift(sel.from)));
  else tr.setSelection(TextSelection.between(tr.doc.resolve(shift(sel.anchor)), tr.doc.resolve(shift(sel.head))));
  // A multi-selection stays selected (the plugin drops its set on any other selection change).
  const ids = multiSelectIds(state);
  if (ids.length >= 2) tr.setMeta(SET_MULTI, { ids, anchor: multiSelectAnchorId(state) });
  tr.setMeta(STRUCTURAL_MOVE, true).setMeta(ALLOW_STRUCTURE, true).scrollIntoView();
  return { tr: closeHistory(tr) };
}

/** Move and dispatch as its own history step (closed after too, so typing next doesn't join it). Returns
 *  the refusal to say, or null when it moved. */
export function runMove(view: EditorView, positions: readonly number[], dir: MoveDir): string | null {
  if (!view.editable) return "This scene is read-only just now.";
  const plan = planMove(view.state, positions, dir);
  if ("refuse" in plan) return plan.refuse;
  const before = view.state.doc;
  view.dispatch(plan.tr);
  if (view.state.doc === before) return null; // refused further down (the guard says why itself)
  view.dispatch(closeHistory(view.state.tr));
  return null;
}
