// ---------------------------------------------------------------------------
// The deletion (Backspace) spine (Z6, spec sections 8 & 9). Backspace traverses
// the same zone spine as Left-arrow but deletes as it goes.
//
//   character-name HIGHLIGHT (the cue token selected) -> dissolve this line into the
//                                   previous one: delete the name, fold the content up
//                                   (mergeLineUp - keeps / drops / inlines the direction
//                                   by what the previous line is).
//
//   say-start, direction present -> step into the direction (at its end)
//   say-start, no direction      -> into the cue, whole speaker SELECTED (popup):
//                                   "change the character", not edit it
//   paren-start, empty           -> collapse the parens
//   paren-start, with text       -> into the cue, whole speaker SELECTED (popup)
//   cue-start, name present      -> step left (wrap), no deletion
//   cue-start, name empty        -> MERGE: append this line's content to the
//                                   previous line; at a bubble's first line,
//                                   merge into the previous bubble.
//
// Merges into a jump or an action are refused (those carry no text / are
// terminal). Within a zone, the command defers to the default per-char delete.
// ---------------------------------------------------------------------------

import { TextSelection, type Command } from "prosemirror-state";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { removeDirection } from "./direction.js";
import { arrowLeft } from "./navigation.js";
import { sayNode, sayText, cueText, zoneText, zoneContentStart, zoneContentEnd, sayStartOf } from "./zoneutil.js";

/** A copy of `beat` with `text` appended to its say zone. */
function appendSay(beat: PMNode, text: string): PMNode {
  if (!text) return beat;
  const children: PMNode[] = [];
  beat.forEach((ch) => {
    if (ch.type.name === "say") { const joined = ch.textContent + text; children.push(S.node("say", null, joined ? [S.text(joined)] : [])); }
    else children.push(ch);
  });
  return beat.copy(Fragment.fromArray(children));
}

/**
 * Delete a ranged selection, honouring the invariants (spec §13.1 / §15): a
 * selection that would remove an action or jump (those go only via the
 * affordance) is refused, so a selection-delete can never smuggle in a structural
 * violation. Plain text/line ranges delete normally.
 */
export const deleteSelectionGuarded: Command = (state, dispatch) => {
  if (state.selection.empty) return false;
  const { from, to } = state.selection;
  let hasAtom = false;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.type.name === "gameEvent") { hasAtom = true; return false; }
    return true;
  });
  if (hasAtom) return true; // refuse
  if (dispatch) dispatch(state.tr.deleteSelection().scrollIntoView());
  return true;
};

export const backspace: Command = (state, dispatch) => {
  if (!state.selection.empty) {
    const sc = context(state);
    // Character-name HIGHLIGHT (the whole cue token selected): one Backspace dissolves
    // this dialogue line into the previous one - delete the name, fold the content up.
    if (sc.beat?.kind === "line" && sc.snippet && sc.block &&
        state.selection.$from.parent.type.name === "cue" && state.selection.$to.parent.type.name === "cue") {
      return mergeLineUp(state, dispatch, sc as Ctx);
    }
    return deleteSelectionGuarded(state, dispatch);
  }
  const c = context(state);
  // A choice option's PROMPT is a single-line field: delete chars within it, but never merge
  // it out (it is tied to the option). At its very start, swallow Backspace; else default-delete.
  if (c.inPrompt) return c.zone != null && c.zone.atStart && c.zone.isFirstZone ? true : false;
  if (!c.beat || !c.snippet) return false;

  // On an atom (action / jump): not deletable via a typing keystroke (spec §10).
  if (!c.zone) return true;
  if (!c.zone.atStart) return false; // default deletes a character within the zone

  // --- say (content) zone, at its start ---
  if (c.zone.role === "say") {
    // Free text has no prefix zone, so its start IS the line's left edge: merge
    // into the line above (delete an empty one; append content to the line above).
    if (c.beat.kind === "prose") return mergeAtStart(state, dispatch, c as Ctx);
    // A direction sits between the cue and the say, so step into it (edit the
    // direction). With no direction the say abuts the cue: move into the character
    // and select it whole (see selectWholeCue) - this is "change the speaker".
    if (c.hasDirection) {
      const target = zoneContentEnd(c.beat.node, c.beat.pos, "paren");
      if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
      return true;
    }
    return selectWholeCue(state, dispatch, c as Ctx);
  }
  if (c.zone.role === "paren") {
    // An empty direction is just collapsed; a non-empty one is stepped past, into
    // the character with the whole speaker selected (change it, do not edit it).
    if (c.zone.textLen === 0) {
      const tr = removeDirection(state);
      if (tr && dispatch) dispatch(tr);
      return true;
    }
    return selectWholeCue(state, dispatch, c as Ctx);
  }

  // --- cue zone, at its start ---
  if (c.zone.textLen > 0) return arrowLeft(state, dispatch); // name present: step/wrap, never merge
  return mergeAtStart(state, dispatch, c as Ctx);             // empty name at the left edge -> merge
};

/**
 * Move into the cue and select the WHOLE speaker. The cast popup opens on a cue
 * selection, so stepping back into the character from the content / direction
 * reads as "I want to change who is talking" rather than "edit the name one
 * character at a time" (an empty name lands as a plain caret - nothing to select).
 */
function selectWholeCue(state: EditorStateLike, dispatch: Dispatch, c: Ctx): boolean {
  if (dispatch) {
    const from = zoneContentStart(c.beat.node, c.beat.pos, "cue");
    const to = zoneContentEnd(c.beat.node, c.beat.pos, "cue");
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView());
  }
  return true;
}

/** Merge at the line's left edge: into the previous line, or the previous bubble. */
function mergeAtStart(state: EditorStateLike, dispatch: Dispatch, c: Ctx): boolean {
  if (!c.firstBeatInSnippet) return mergeIntoPrevBeat(state, dispatch, c);
  if (!c.firstSnippetInBlock) return mergeIntoPrevBubble(state, dispatch, c);
  return true; // first line of the first bubble: nothing to merge into
}

function mergeIntoPrevBeat(state: EditorStateLike, dispatch: Dispatch, c: Ctx): boolean {
  const prev = c.snippet.node.child(c.beat.index - 1);
  // A game event above carries no text to merge: Backspace at the line's start DELETES it
  // (the natural "join upward" past an atom). The current line stays put - the caret
  // just shifts up with the removal. A terminal jump is never followed by a line.
  if (prev.type.name === "gameEvent") {
    if (dispatch) {
      const prevPos = c.beat.pos - prev.nodeSize;
      const tr = state.tr.delete(prevPos, prevPos + prev.nodeSize);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, state.selection.from - prev.nodeSize)).scrollIntoView());
    }
    return true;
  }
  if (prev.type.name !== "line" && prev.type.name !== "prose") return true; // refuse: jump target
  const prevPos = c.beat.pos - prev.nodeSize;
  const prevSay = sayNode(prev)!;
  const prevSayEnd = zoneContentStart(prev, prevPos, "say") + prevSay.content.size;
  const text = sayText(c.beat.node);
  if (dispatch) {
    const tr = state.tr.delete(c.beat.pos, c.beat.pos + c.beat.node.nodeSize);
    if (text) tr.insertText(text, prevSayEnd);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, prevSayEnd)).scrollIntoView());
  }
  return true;
}

function mergeIntoPrevBubble(state: EditorStateLike, dispatch: Dispatch, c: Ctx): boolean {
  // The snippet's IMMEDIATE container (a block OR a group) - so merging inside a
  // group stays inside it, and a group seam is never crossed (groups §10).
  const parent = state.doc.resolve(c.snippet.pos).parent;
  const prevSnip = parent.child(c.snippet.index - 1);
  if (prevSnip.type.name !== "snippet") return true; // refuse: previous chunk is a group
  const prevLast = prevSnip.lastChild;
  // Refuse unless the previous bubble ends in a mergeable line/prose - never an
  // action or a terminal jump (spec §8/§15): there is nothing to append into.
  if (!prevLast || (prevLast.type.name !== "line" && prevLast.type.name !== "prose")) return true;

  const cur = c.snippet.node;
  const prevBeats: PMNode[] = []; prevSnip.forEach((ch) => prevBeats.push(ch));
  const curBeats: PMNode[] = []; cur.forEach((ch) => curBeats.push(ch));
  if (prevBeats.length === 0 || curBeats.length === 0) return true; // a beat-less (un-entered) bubble: nothing to fold

  const mergedLast = appendSay(prevBeats[prevBeats.length - 1]!, sayText(curBeats[0]!));
  const newPrev = prevSnip.copy(Fragment.fromArray([...prevBeats.slice(0, -1), mergedLast, ...curBeats.slice(1)]));

  if (dispatch) {
    const prevPos = c.snippet.pos - prevSnip.nodeSize;
    // delete the current snippet first (it is after prevSnip, so prevPos is stable), then replace prev.
    const tr = state.tr.delete(c.snippet.pos, c.snippet.pos + cur.nodeSize);
    tr.replaceWith(prevPos, prevPos + prevSnip.nodeSize, newPrev);
    // caret at the seam (end of prev's original last beat content)
    const seam = sayStartOf(tr.doc, prevLast.attrs.id as string) + (sayNode(prevLast)?.content.size ?? 0);
    if (seam >= 0) tr.setSelection(TextSelection.create(tr.doc, seam));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** The mergeable line/prose immediately before L in document order (prev beat in the
 *  snippet, else the previous bubble's last beat) + its position - or null if none. */
function prevLineOf(state: EditorStateLike, c: Ctx): { node: PMNode; pos: number; sameSnippet: boolean } | null {
  if (!c.firstBeatInSnippet) {
    const P = c.snippet.node.child(c.beat.index - 1);
    if (P.type.name !== "line" && P.type.name !== "prose") return null; // action / jump above: not a line
    return { node: P, pos: c.beat.pos - P.nodeSize, sameSnippet: true };
  }
  if (!c.firstSnippetInBlock) {
    const parent = state.doc.resolve(c.snippet.pos).parent;
    const prevSnip = parent.child(c.snippet.index - 1);
    if (prevSnip.type.name !== "snippet") return null; // previous chunk is a group
    const P = prevSnip.lastChild;
    if (!P || (P.type.name !== "line" && P.type.name !== "prose")) return null;
    return { node: P, pos: c.snippet.pos - 1 - P.nodeSize, sameSnippet: false };
  }
  return null;
}

/** L's content folded into the previous line P, per the merge rules:
 *   - P is text (prose): keep it text, inline L's direction into the text;
 *   - P is dialogue WITH content: keep P's direction, DROP L's, concatenate the say;
 *   - P is dialogue with NO content: take everything from L (its say AND its direction). */
function foldInto(P: PMNode, L: PMNode): PMNode {
  const lSay = sayText(L);
  const lDir = zoneText(L, "paren");
  if (P.type.name === "prose") {
    const text = sayText(P) + (lDir ? `(${lDir}) ` : "") + lSay;
    return S.node("prose", P.attrs, [S.node("say", null, text ? [S.text(text)] : [])]);
  }
  const cue = S.node("cue", null, cueText(P) ? [S.text(cueText(P))] : []);
  const pSay = sayText(P);
  if (pSay.length > 0) {
    const kids: PMNode[] = [cue];
    const pDir = zoneText(P, "paren"); if (pDir) kids.push(S.node("paren", null, [S.text(pDir)]));
    kids.push(S.node("say", null, [S.text(pSay + lSay)]));
    return S.node("line", P.attrs, kids);
  }
  const dir = lDir || zoneText(P, "paren");
  const kids: PMNode[] = [cue];
  if (dir) kids.push(S.node("paren", null, [S.text(dir)]));
  kids.push(S.node("say", null, lSay ? [S.text(lSay)] : []));
  return S.node("line", P.attrs, kids);
}

/** Dissolve this dialogue line into the previous line: delete the (highlighted) name,
 *  fold the content up per the rules, and drop a now-empty source bubble. */
function mergeLineUp(state: EditorStateLike, dispatch: Dispatch, c: Ctx): boolean {
  const prev = prevLineOf(state, c);
  if (!prev) return deleteSelectionGuarded(state, dispatch); // nothing above: just clear the name
  if (!dispatch) return true;

  const L = c.beat.node;
  const newP = foldInto(prev.node, L);
  const seamOffset = sayText(prev.node).length; // caret lands where L's content joins on

  const tr = state.tr;
  // Remove L (it is AFTER P, so P's position stays put). If L was the only beat of its
  // (different) bubble and that bubble has no jump, drop the empty bubble too.
  const bubble = c.snippet.node;
  if (!prev.sameSnippet && bubble.childCount === 1 && !bubble.attrs.jump) {
    tr.delete(c.snippet.pos, c.snippet.pos + bubble.nodeSize);
  } else {
    tr.delete(c.beat.pos, c.beat.pos + L.nodeSize);
  }
  tr.replaceWith(prev.pos, prev.pos + prev.node.nodeSize, newP);

  const caret = sayStartOf(tr.doc, prev.node.attrs.id as string) + seamOffset;
  if (caret >= 0) tr.setSelection(TextSelection.create(tr.doc, caret));
  dispatch(tr.scrollIntoView());
  return true;
}

// Minimal structural typing to keep the helpers readable.
type EditorStateLike = import("prosemirror-state").EditorState;
type Dispatch = ((tr: import("prosemirror-state").Transaction) => void) | undefined;
type Ctx = ReturnType<typeof context> & {
  beat: NonNullable<ReturnType<typeof context>["beat"]>;
  snippet: NonNullable<ReturnType<typeof context>["snippet"]>;
  block: NonNullable<ReturnType<typeof context>["block"]>;
};
