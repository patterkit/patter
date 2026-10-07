// ---------------------------------------------------------------------------
// The deletion spine (Z6, spec sections 8 & 9). Backspace traverses the same
// zone spine as Left-arrow but deletes as it goes; forward Delete mirrors it.
//
// Backspace:
//   character-name HIGHLIGHT (the cue token selected) -> dissolve this line into the
//                                   previous one: delete the name, fold the content up
//                                   (mergeLineUp - keeps / drops / inlines the direction
//                                   by what the previous line is).
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
// Forward Delete (review 2026-10, MEDIUM 37):
//   say-end, next beat a line / text in the same bubble -> fold the next line's
//                                   words into this one (foldInto, as Backspace does)
//   paren-end, empty             -> collapse the parens
//   anywhere else at a zone's end -> nothing: never a whole-line node selection.
//
// A merge never crosses a game event (it carries no text) and never drops a
// snippet's logic: a merge that would is refused with a sentence for the host
// (guard.ts). A choice prompt is a single field, so nothing merges out of it.
// Within a zone, the commands defer to the default per-character delete.
// Inline bold / italic survive every merge: content moves as Fragments, never
// rebuilt from text.
// ---------------------------------------------------------------------------

import { TextSelection, type Command } from "prosemirror-state";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { removeDirection } from "./direction.js";
import { arrowLeft } from "./navigation.js";
import { sayNode, cueText, zoneText, zoneContentStart, zoneContentEnd, sayStartOf, beatNode, rawAttr } from "./zoneutil.js";
import { refusal, snippetLossMessage } from "./guard.js";

/** A say zone's inline content (text with its marks), or empty. */
const sayContent = (beat: PMNode): Fragment => sayNode(beat)?.content ?? Fragment.empty;

/** A copy of `beat` with `content` (marks and all) appended to its say zone. */
function appendSay(beat: PMNode, content: Fragment): PMNode {
  if (!content.size) return beat;
  const children: PMNode[] = [];
  beat.forEach((ch) => children.push(ch.type.name === "say" ? ch.copy(ch.content.append(content)) : ch));
  return beat.copy(Fragment.fromArray(children));
}

/** Does a beat carry game data or tags (which a merge removing it would lose)? */
function carriesData(beat: PMNode): boolean {
  const raw = rawAttr(beat);
  const gd = raw.gameData;
  return (!!gd && typeof gd === "object" && Object.keys(gd).length > 0) || (Array.isArray(raw.tags) && raw.tags.length > 0);
}

/**
 * Delete a ranged selection, honouring the invariants (spec §13.1 / §15): a
 * selection that would remove a game event (it goes only via its own ×) is
 * refused, so a selection-delete can never smuggle in a structural
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
  // A choice option's PROMPT is a single field tied to its option: it walks the same zone spine as any
  // line (say -> direction -> the speaker selected whole), but nothing ever merges out of it, so at its
  // left edge Backspace is swallowed. It used to fall through to ProseMirror's own join there, which
  // deleted the speaker in two presses (review 2026-10).
  if (c.inPrompt) {
    if (!c.beat || !c.zone) return true;
    if (!c.zone.atStart) return false;
    if (c.beat.kind === "line" && c.zone.role === "say") {
      if (c.hasDirection) {
        const target = zoneContentEnd(c.beat.node, c.beat.pos, "paren");
        if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
        return true;
      }
      return selectWholeCue(state, dispatch, c.beat);
    }
    if (c.zone.role === "paren") {
      if (c.zone.textLen === 0) { const tr = removeDirection(state); if (tr && dispatch) dispatch(tr); return true; }
      return selectWholeCue(state, dispatch, c.beat);
    }
    return true;
  }
  if (!c.beat || !c.snippet) return false;

  // On a game-event atom: not deletable via a typing keystroke, only its × (spec §10).
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
    return selectWholeCue(state, dispatch, c.beat);
  }
  if (c.zone.role === "paren") {
    // An empty direction is just collapsed; a non-empty one is stepped past, into
    // the character with the whole speaker selected (change it, do not edit it).
    if (c.zone.textLen === 0) {
      const tr = removeDirection(state);
      if (tr && dispatch) dispatch(tr);
      return true;
    }
    return selectWholeCue(state, dispatch, c.beat);
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
function selectWholeCue(state: EditorStateLike, dispatch: Dispatch, beat: { node: PMNode; pos: number }): boolean {
  if (dispatch) {
    const from = zoneContentStart(beat.node, beat.pos, "cue");
    const to = zoneContentEnd(beat.node, beat.pos, "cue");
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
  const content = sayContent(c.beat.node);
  if (dispatch) {
    const tr = state.tr.delete(c.beat.pos, c.beat.pos + c.beat.node.nodeSize);
    // Insert the content itself, not its text: insertText would take the marks at the seam, smearing
    // the previous line's bold over these words and dropping their own (review 2026-10, MEDIUM 32).
    if (content.size) tr.insert(prevSayEnd, content);
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

  // The merged bubble keeps the previous bubble's attributes, so this bubble's own logic would go, and
  // the previous bubble's jump would end up after these lines. Both are refused with a reason (ruling D).
  const refuse = prevSnip.attrs.jump ? "The previous bubble ends in a jump. Move or clear it first." : snippetLossMessage("This bubble", cur);
  if (refuse) { if (dispatch) dispatch(refusal(state, refuse)); return true; }

  const mergedLast = appendSay(prevBeats[prevBeats.length - 1]!, sayContent(curBeats[0]!));
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
function prevLineOf(state: EditorStateLike, c: Ctx): { node: PMNode; pos: number; sameSnippet: boolean; snippet: PMNode } | null {
  if (!c.firstBeatInSnippet) {
    const P = c.snippet.node.child(c.beat.index - 1);
    if (P.type.name !== "line" && P.type.name !== "prose") return null; // a game event above: not a line
    return { node: P, pos: c.beat.pos - P.nodeSize, sameSnippet: true, snippet: c.snippet.node };
  }
  if (!c.firstSnippetInBlock) {
    const parent = state.doc.resolve(c.snippet.pos).parent;
    const prevSnip = parent.child(c.snippet.index - 1);
    if (prevSnip.type.name !== "snippet") return null; // previous chunk is a group
    const P = prevSnip.lastChild;
    if (!P || (P.type.name !== "line" && P.type.name !== "prose")) return null;
    return { node: P, pos: c.snippet.pos - 1 - P.nodeSize, sameSnippet: false, snippet: prevSnip };
  }
  return null;
}

/** L's content folded into the line P before it, per the merge rules:
 *   - P is text (prose): keep it text, inline L's direction into the text;
 *   - P is dialogue WITH content: keep P's direction, DROP L's, concatenate the say;
 *   - P is dialogue with NO content: take everything from L (its say AND its direction).
 *  P keeps its id and raw. The say moves as content, so bold / italic survive the fold. */
function foldInto(P: PMNode, L: PMNode): PMNode {
  const lSay = sayContent(L);
  const lDir = zoneText(L, "paren");
  const keep = { id: P.attrs.id as string, raw: P.attrs.raw as string };
  if (P.type.name === "prose") {
    const dir = lDir ? Fragment.from(S.text(`(${lDir}) `)) : Fragment.empty;
    return beatNode("prose", { ...keep, say: sayContent(P).append(dir).append(lSay) });
  }
  const pSay = sayContent(P);
  if (pSay.size > 0) return beatNode("line", { ...keep, speaker: cueText(P), direction: zoneText(P, "paren"), say: pSay.append(lSay) });
  return beatNode("line", { ...keep, speaker: cueText(P), direction: lDir || zoneText(P, "paren"), say: lSay });
}

/** Dissolve this dialogue line into the previous line: delete the (highlighted) name,
 *  fold the content up per the rules, and drop a now-empty source bubble. */
function mergeLineUp(state: EditorStateLike, dispatch: Dispatch, c: Ctx): boolean {
  const prev = prevLineOf(state, c);
  if (!prev) return deleteSelectionGuarded(state, dispatch); // nothing above: just clear the name

  const L = c.beat.node;
  const bubble = c.snippet.node;
  // Across a bubble boundary the same rules as a bubble merge hold (ruling D): the previous bubble's
  // jump would end up after this line, and dropping this now-empty bubble would drop its logic.
  if (!prev.sameSnippet) {
    const dropsBubble = bubble.childCount === 1 && !bubble.attrs.jump;
    const refuse = prev.snippet.attrs.jump ? "The previous bubble ends in a jump. Move or clear it first."
      : dropsBubble ? snippetLossMessage("This bubble", bubble) : null;
    if (refuse) { if (dispatch) dispatch(refusal(state, refuse)); return true; }
  }
  if (!dispatch) return true;
  const newP = foldInto(prev.node, L);
  const seamOffset = sayContent(prev.node).size; // caret lands where L's content joins on

  const tr = state.tr;
  // Remove L (it is AFTER P, so P's position stays put). If L was the only beat of its
  // (different) bubble and that bubble has no jump, drop the empty bubble too.
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

/**
 * Forward Delete, designed to mirror Backspace's spine rather than fall through to ProseMirror's
 * joinForward (which, at a line's end, node-selected the whole next line on the first press and deleted
 * it on the second). See the module header for the table.
 */
export const forwardDelete: Command = (state, dispatch) => {
  if (!state.selection.empty) return deleteSelectionGuarded(state, dispatch);
  const c = context(state);
  if (!c.beat) return false;
  if (!c.zone) return true;          // a game event: removed only by its own ×
  if (!c.zone.atEnd) return false;   // default deletes a character within the zone
  if (c.zone.role === "paren") {
    // An empty direction collapses, and the caret goes on to the words; a written one stays.
    if (c.zone.textLen === 0) {
      const tr = removeDirection(state);
      if (tr && dispatch) {
        const beat = tr.doc.nodeAt(c.beat.pos);
        const say = beat ? zoneContentStart(beat, c.beat.pos, "say") : -1;
        if (say >= 0) tr.setSelection(TextSelection.create(tr.doc, say));
        dispatch(tr);
      }
    }
    return true;
  }
  if (!c.zone.isLastZone) return true; // the end of a name: nothing to delete forward into
  if (c.inPrompt || !c.snippet) return true; // a prompt is a single field
  const nextIndex = c.beat.index + 1;
  if (nextIndex >= c.snippet.node.childCount) return true; // the bubble's last line: no merge across bubbles
  const next = c.snippet.node.child(nextIndex);
  if (next.type.name !== "line" && next.type.name !== "prose") return true; // a game event is not text
  if (carriesData(next)) return true; // merging would delete its game data or tags
  if (!dispatch) return true;
  const here = c.beat.node;
  const nextPos = c.beat.pos + here.nodeSize;
  const merged = foldInto(here, next);
  const seam = sayContent(here).size;
  const tr = state.tr.delete(nextPos, nextPos + next.nodeSize).replaceWith(c.beat.pos, nextPos, merged);
  const sayStart = zoneContentStart(merged, c.beat.pos, "say");
  dispatch(tr.setSelection(TextSelection.create(tr.doc, sayStart + seam)).scrollIntoView());
  return true;
};

// Minimal structural typing to keep the helpers readable.
type EditorStateLike = import("prosemirror-state").EditorState;
type Dispatch = ((tr: import("prosemirror-state").Transaction) => void) | undefined;
type Ctx = ReturnType<typeof context> & {
  beat: NonNullable<ReturnType<typeof context>["beat"]>;
  snippet: NonNullable<ReturnType<typeof context>["snippet"]>;
  block: NonNullable<ReturnType<typeof context>["block"]>;
};
