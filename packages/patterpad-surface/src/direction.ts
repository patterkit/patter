// ---------------------------------------------------------------------------
// The direction (paren) zone (Z4, spec section 3). A direction is an
// always-available sub-region of a dialogue line's prefix, between the cue and
// the content, stored in LineBeat.direction (the parens are chrome).
//
//   openDirection   - "(" in the cue zone, or at content-start before any content
//                     exists: insert an empty paren zone and drop the caret in it.
//                     Returns false elsewhere, so "(" mid-content is a literal.
//   closeDirection  - ")" in the paren zone: return the caret to the content.
//   removeDirection - delete the paren zone (used by the deletion spine, Z6).
//
// "(" / ")" reach these via handleTextInput in the web layer; the commands are
// pure over EditorState and testable without a view.
// ---------------------------------------------------------------------------

import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { lineZones } from "./zoneutil.js";

/** "(" - open a direction in the cue zone or at empty content-start. */
export const openDirection: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat || c.beat.kind !== "line" || !c.zone) return false;
  const inCue = c.zone.role === "cue";
  // At content-start a "(" opens a direction even when content already exists
  // (insert one before the line); only MID-content is "(" a literal character.
  const atContentStart = c.zone.role === "say" && c.zone.atStart;
  if (!inCue && !atContentStart) return false;

  if (dispatch) {
    const z = lineZones(c.beat.node, c.beat.pos);
    if (!z.paren) {
      const tr = state.tr.insert(z.say!.pos, S.node("paren", null, []));
      dispatch(tr.setSelection(TextSelection.create(tr.doc, z.say!.pos + 1)).scrollIntoView());
    } else {
      const end = z.paren.pos + 1 + z.paren.node.content.size;
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, end)).scrollIntoView());
    }
  }
  return true;
};

/** ")" - close the direction, returning the caret to the content zone. */
export const closeDirection: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat || c.beat.kind !== "line" || c.zone?.role !== "paren") return false;
  if (dispatch) {
    const z = lineZones(c.beat.node, c.beat.pos);
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, z.say!.pos + 1)).scrollIntoView());
  }
  return true;
};

/** Delete a line's direction zone, returning the caret to the end of the cue. */
export function removeDirection(state: EditorState): Transaction | null {
  const c = context(state);
  if (!c.beat || c.beat.kind !== "line") return null;
  const z = lineZones(c.beat.node, c.beat.pos);
  if (!z.paren) return null;
  const tr = state.tr.delete(z.paren.pos, z.paren.pos + z.paren.node.nodeSize);
  const cueEnd = z.cue!.pos + 1 + z.cue!.node.content.size;
  return tr.setSelection(TextSelection.create(tr.doc, cueEnd)).scrollIntoView();
}
