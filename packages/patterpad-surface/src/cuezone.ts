// ---------------------------------------------------------------------------
// The character (cue) zone behaviour (Z3, spec section 2). The speaker is a TOKEN,
// not editable text (the cast popup owns the search buffer; see web/cuepopup.ts).
// The cue node still stores the committed name as the textblock's content, and
// these pure commands are how that content is set / queried:
//
//   acceptCue(name) - set the cue to an explicit name (a popup pick / "add new")
//                     wholesale and advance to the say (content) zone.
//   cueSuggestions  - filter a recency-ordered cast by the typed prefix, order
//                     preserved (the list is the shell's; ordering is the shell's).
//
// There is no ":" commit path: the colon is display chrome only (spec section 2),
// never a keystroke. The commands are pure over EditorState, testable without a view.
// ---------------------------------------------------------------------------

import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { zoneContentStart, findBeatById } from "./zoneutil.js";

/** Replace a line beat's cue with `name` and advance the caret to its say content. Locates the cue
 *  + say from the beat node itself, so it is robust to where the caret currently sits. */
function setCueOnBeat(state: EditorState, beat: PMNode, beatPos: number, name: string): Transaction | null {
  if (beat.type.name !== "line") return null;
  let cueStart = -1, cueEnd = -1;
  beat.forEach((child, offset) => {
    if (child.type.name === "cue") { cueStart = beatPos + 1 + offset + 1; cueEnd = cueStart + child.content.size; }
  });
  if (cueStart < 0) return null;
  const sayStartBefore = zoneContentStart(beat, beatPos, "say");
  const tr = state.tr.replaceWith(cueStart, cueEnd, name.length > 0 ? S.text(name) : []);
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(sayStartBefore)));
  return tr.scrollIntoView();
}

/** Accept an explicit character name into the cue zone and advance to content. */
export function acceptCue(state: EditorState, name: string): Transaction | null {
  const c = context(state);
  if (!c.zone || c.zone.role !== "cue" || !c.beat) return null;
  return setCueOnBeat(state, c.beat.node, c.beat.pos, name);
}

/**
 * Accept a character name for a SPECIFIC beat id, regardless of the caret's current zone. The cast
 * popup uses this: it knows which cue it is editing, and in the live editor the DOM selection can
 * drift out of the freshly-inserted cue before Enter is pressed - in which case `acceptCue` (which
 * reads the caret) would bail and leave the caret stranded at the line start. Looking the beat up by
 * id makes "pick a speaker -> land in content" reliable.
 */
export function acceptCueForBeat(state: EditorState, beatId: string, name: string): Transaction | null {
  const found = findBeatById(state.doc, beatId);
  if (!found) return null;
  return setCueOnBeat(state, found.node, found.pos, name);
}

/** Recency-ordered cast filtered by the typed prefix (order preserved). */
export function cueSuggestions(typed: string, orderedCast: readonly string[]): string[] {
  const t = typed.trim().toLowerCase();
  if (t.length === 0) return [...orderedCast];
  return orderedCast.filter((c) => c.toLowerCase().startsWith(t));
}
