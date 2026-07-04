// ---------------------------------------------------------------------------
// The horizontal navigation spine (Z2, spec section 6). Left/Right step the zone
// sequence (cue -> paren? -> say) and, at a line's edges, WRAP to the adjacent
// line - the one sanctioned cross-line horizontal move, symmetric in both
// directions. Atoms (action / jump) are stepped onto as node selections.
// Within a zone, the commands return false so the default per-character movement
// applies; only at a zone boundary do they take over.
// ---------------------------------------------------------------------------

import { TextSelection, NodeSelection, type Command, type EditorState } from "prosemirror-state";
import { context } from "./context.js";
import { adjacentBeat, zonePositions, isZoneBeat, type BeatRef } from "./zoneutil.js";

/** A selection placing the caret at the start of a beat (first zone), or selecting an atom. */
function atBeatStart(state: EditorState, beat: BeatRef) {
  if (isZoneBeat(beat.node)) return TextSelection.create(state.doc, zonePositions(beat.node, beat.pos)[0]!.pos + 1);
  return NodeSelection.create(state.doc, beat.pos);
}

/** A selection placing the caret at the end of a beat (last zone), or selecting an atom. */
function atBeatEnd(state: EditorState, beat: BeatRef) {
  if (isZoneBeat(beat.node)) {
    const last = zonePositions(beat.node, beat.pos).at(-1)!;
    return TextSelection.create(state.doc, last.pos + 1 + last.node.content.size);
  }
  return NodeSelection.create(state.doc, beat.pos);
}

export const arrowRight: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat) return false;

  // On an atom (no zone): step to the next beat's start.
  if (!c.zone) {
    const next = adjacentBeat(state.doc, c.beat.pos, 1);
    if (!next) return false;
    if (dispatch) dispatch(state.tr.setSelection(atBeatStart(state, next)).scrollIntoView());
    return true;
  }
  if (!c.zone.atEnd) return false; // default moves within the zone

  const zs = zonePositions(c.beat.node, c.beat.pos);
  if (!c.zone.isLastZone) {
    const nextZone = zs[c.zone.indexInBeat + 1]!;
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, nextZone.pos + 1)).scrollIntoView());
    return true;
  }
  const next = adjacentBeat(state.doc, c.beat.pos, 1);
  if (!next) return false; // end of document
  if (dispatch) dispatch(state.tr.setSelection(atBeatStart(state, next)).scrollIntoView());
  return true;
};

export const arrowLeft: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat) return false;

  if (!c.zone) {
    const prev = adjacentBeat(state.doc, c.beat.pos, -1);
    if (!prev) return false;
    if (dispatch) dispatch(state.tr.setSelection(atBeatEnd(state, prev)).scrollIntoView());
    return true;
  }
  if (!c.zone.atStart) return false;

  const zs = zonePositions(c.beat.node, c.beat.pos);
  if (!c.zone.isFirstZone) {
    const prevZone = zs[c.zone.indexInBeat - 1]!;
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, prevZone.pos + 1 + prevZone.node.content.size)).scrollIntoView());
    return true;
  }
  const prev = adjacentBeat(state.doc, c.beat.pos, -1);
  if (!prev) return false; // start of document
  if (dispatch) dispatch(state.tr.setSelection(atBeatEnd(state, prev)).scrollIntoView());
  return true;
};

export const navKeymap: Record<string, Command> = { ArrowRight: arrowRight, ArrowLeft: arrowLeft };
