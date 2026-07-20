// ---------------------------------------------------------------------------
// Line creation, mirroring, and bubble boundaries (Z5, spec sections 5 & 9).
//
//   enter      - Enter. With content: a new line in the SAME bubble, mirroring
//                the previous line's type and (for dialogue) pre-filling the
//                speaker, caret in content. On an EMPTY line (no content typed):
//                end the bubble - the empty line becomes the first line of a fresh
//                bubble (split before it). The continuation case (same speaker,
//                straight into content) is the zero-interaction default.
//   endBubble  - Shift-Enter / Cmd-Enter. End the bubble now even with content:
//                split after the current line; the new bubble gets a fresh
//                mirrored line (or the following beats), caret there.
//
// In the zone model the jump is a node, so it moves with the tail on a split -
// no raw jump bookkeeping needed. New snippets get a fresh id.
// ---------------------------------------------------------------------------

import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { newId } from "@patterkit/core";
import { patterSchema as S } from "./schema.js";
import { context, type ZoneState } from "./context.js";
import { cueText, zoneContentStart, zoneContentEnd, findBeatById } from "./zoneutil.js";

/** A fresh beat mirroring the current one, plus the caret offset to its say content. */
function mirroredBeat(c: ZoneState): { node: PMNode; sayOffset: number } {
  if (c.beat!.kind === "line") {
    const cue = S.node("cue", null, cueText(c.beat!.node) ? [S.text(cueText(c.beat!.node))] : []);
    const say = S.node("say", null, []);
    return { node: S.node("line", { id: newId("L"), raw: "{}" }, [cue, say]), sayOffset: 1 + cue.nodeSize + 1 };
  }
  return { node: S.node("prose", { id: newId("L"), raw: "{}" }, [S.node("say", null, [])]), sayOffset: 2 };
}


/**
 * Land the cursor on a beat (located by id) the way a fresh line should read: a
 * dialogue line lands in the cue with its (pre-filled) speaker SELECTED - type to
 * replace, arrows to pick, Tab to accept, Space/"/" for free-text/special; a free
 * text line lands in its content.
 */
export function landOnBeat(tr: import("prosemirror-state").Transaction, beatId: string): void {
  const found = findBeatById(tr.doc, beatId);
  if (!found) return;
  const { node, pos } = found;
  if (node.type.name === "line") {
    const name = cueText(node);
    const cueStart = pos + 2; // line open + cue open
    tr.setSelection(name.length > 0
      ? TextSelection.create(tr.doc, cueStart, cueStart + name.length)
      : TextSelection.create(tr.doc, cueStart));
  } else {
    const sayStart = zoneContentStart(node, pos, "say");
    if (sayStart >= 0) tr.setSelection(TextSelection.create(tr.doc, sayStart));
  }
}

/** Replace a beat's say-zone text with `text` (used by Accept on a "suggest a rewrite", see
 *  design/proposals/suggest-rewrite.md). Returns a transaction, or null if the beat / its say zone is
 *  gone. Inline formatting marks in the say zone are dropped - a suggestion proposes plain text. */
export function replaceSayText(state: EditorState, beatId: string, text: string): import("prosemirror-state").Transaction | null {
  const found = findBeatById(state.doc, beatId);
  if (!found) return null;
  const from = zoneContentStart(found.node, found.pos, "say");
  const to = zoneContentEnd(found.node, found.pos, "say");
  if (from < 0 || to < 0) return null;
  const tr = state.tr;
  if (text) tr.replaceWith(from, to, state.schema.text(text));
  else tr.delete(from, to);
  return tr;
}

export const enter: Command = (state, dispatch) => {
  const c = context(state);
  if (c.inPrompt) return true; // a choice prompt is a single line: swallow Enter (no split, no new beat)
  if (!c.beat || (c.beat.kind !== "line" && c.beat.kind !== "prose") || !c.snippet) return false;
  if (!dispatch) return true;

  // Mid-content: split the say at the caret. The text after the caret moves to a
  // new line of the same kind in the SAME bubble - dialogue keeps the speaker (no
  // popup); the caret lands at the start of the new line's content. Only when the
  // caret is in the say with text after it (at the end it is a plain continuation).
  if (c.zone && c.zone.role === "say" && !c.zone.atEnd) {
    dispatch(splitSayAtCaret(state, c).scrollIntoView());
    return true;
  }

  // A mirrored new line in the SAME bubble - Enter never ends the bubble (that is
  // Shift-Enter). In the cue, the web layer handles Enter as "confirm the name"
  // before this command runs, so Enter here always means "next line".
  const { node } = mirroredBeat(c);
  const insertAt = c.beat.pos + c.beat.node.nodeSize;
  const tr = state.tr.insert(insertAt, node);
  landOnBeat(tr, node.attrs.id as string);
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Insert a fresh dialogue line at the TOP of a snippet (the hover "+" affordance).
 * This is the only way to add a line ABOVE a snippet's first beat - and so the only
 * way to add a line to a snippet that holds just a jump or an action (you can't
 * type past a terminal / atom beat). Lands like a new line: in the cue, with the
 * carried speaker SELECTED (the first dialogue line's speaker, if the snippet has one).
 */
export function prependLine(state: EditorState, snippetPos: number): import("prosemirror-state").Transaction | null {
  const snip = state.doc.nodeAt(snippetPos);
  if (!snip || snip.type.name !== "snippet") return null;
  let speaker = "";
  snip.forEach((b) => { if (!speaker && b.type.name === "line") speaker = cueText(b); });
  const cue = S.node("cue", null, speaker ? [S.text(speaker)] : []);
  const line = S.node("line", { id: newId("L"), raw: "{}" }, [cue, S.node("say", null, [])]);
  const tr = state.tr.insert(snippetPos + 1, line); // start of the snippet's content
  landOnBeat(tr, line.attrs.id as string);
  return tr.scrollIntoView();
}

/** Split the current say at the caret, carrying the tail into a fresh sibling beat. */
function splitSayAtCaret(state: EditorState, c: ZoneState): import("prosemirror-state").Transaction {
  const beat = c.beat!;
  const tail = c.zone!.node.content.cut(c.zone!.offset); // say text after the caret
  let newBeat: PMNode; let sayOffset: number;
  if (beat.kind === "line") {
    const name = cueText(beat.node);
    const cue = S.node("cue", null, name ? [S.text(name)] : []);
    newBeat = S.node("line", { id: newId("L"), raw: "{}" }, [cue, S.node("say", null, tail)]);
    sayOffset = 1 + cue.nodeSize + 1;
  } else {
    newBeat = S.node("prose", { id: newId("L"), raw: "{}" }, [S.node("say", null, tail)]);
    sayOffset = 2;
  }
  const sayEnd = zoneContentEnd(beat.node, beat.pos, "say");
  const tr = state.tr.delete(state.selection.from, sayEnd); // drop the tail from this line
  const insertAt = tr.mapping.map(beat.pos + beat.node.nodeSize);
  tr.insert(insertAt, newBeat);
  return tr.setSelection(TextSelection.create(tr.doc, insertAt + sayOffset)); // caret at the new content start
}

export const endBubble: Command = (state, dispatch) => {
  const c = context(state);
  if (c.inPrompt) return true; // a choice prompt is a single line: no bubble-split
  if (!c.beat || (c.beat.kind !== "line" && c.beat.kind !== "prose") || !c.snippet) return false;
  if (!dispatch) return true;

  const afterBeat = c.beat.pos + c.beat.node.nodeSize;
  const tr = state.tr.split(afterBeat, 1);
  const pair = splitSnippetPair(tr, c.snippet.pos);
  if (!pair) { dispatch(tr.scrollIntoView()); return true; }
  const { aPos, bPos } = pair;

  // split() copies the snippet's attrs to BOTH halves, but a terminal jump belongs
  // to the SECOND bubble only - clear it on the first so the jump "moves down" with
  // the tail (B keeps the copy).
  const a = tr.doc.nodeAt(aPos)!;
  if (a.attrs.jump) tr.setNodeMarkup(aPos, undefined, { ...a.attrs, jump: "" });

  const b = tr.doc.nodeAt(bPos)!;
  const first = b.firstChild;
  // Land like a fresh line: a dialogue line drops into the cue with its speaker
  // SELECTED (popup open) - a new bubble is otherwise just a new line. An empty B
  // (the split was after the last beat) gets a fresh mirrored line.
  if (!first) {
    const { node } = mirroredBeat(c);
    tr.insert(bPos + 1, node);
    landOnBeat(tr, node.attrs.id as string);
  } else {
    landOnBeat(tr, first.attrs.id as string);
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Split the snippet at `snippetPos` so the caret's beat begins a NEW bubble - the action
 * menu's "Split here" (the structural twin of Shift-Enter's split-after). The caret must
 * sit inside THIS snippet, past its first beat (so neither half is empty). The terminal
 * jump and a fresh id go to the tail (B), exactly like endBubble.
 */
export function splitSnippetHere(state: EditorState, snippetPos: number): import("prosemirror-state").Transaction | null {
  const c = context(state);
  if (!c.snippet || c.snippet.pos !== snippetPos || !c.beat) return null; // caret must be in this snippet
  if (c.beat.pos <= c.snippet.pos + 1) return null;                       // already the first beat: A would be empty
  const tr = state.tr.split(c.beat.pos, 1); // split BEFORE the caret's beat
  const pair = splitSnippetPair(tr, c.snippet.pos);
  if (!pair) return null;
  const { aPos, bPos } = pair;
  const a = tr.doc.nodeAt(aPos)!;
  if (a.attrs.jump) tr.setNodeMarkup(aPos, undefined, { ...a.attrs, jump: "" }); // jump moves down with the tail
  const first = tr.doc.nodeAt(bPos)!.firstChild;
  if (first) landOnBeat(tr, first.attrs.id as string);
  return tr.scrollIntoView();
}

/** The two halves of a just-split snippet pair. `tr.split` left the first half (A) at `snippetPos`
 *  (positions before the split point are unchanged) and the tail (B) as its next sibling, so both
 *  positions are derivable directly - no whole-doc scan. The SECOND (B) gets a fresh id (the split
 *  copied A's raw, so they'd otherwise share one). Returns their positions, or null if B isn't a snippet. */
function splitSnippetPair(tr: import("prosemirror-state").Transaction, snippetPos: number): { aPos: number; bPos: number } | null {
  const a = tr.doc.nodeAt(snippetPos);
  if (!a || a.type.name !== "snippet") return null;
  const aPos = snippetPos;
  const bPos = aPos + a.nodeSize;
  const b = tr.doc.nodeAt(bPos);
  if (!b || b.type.name !== "snippet") return null;
  // split() copies the WHOLE snippet onto B, so B would inherit A's authored logic - its condition and
  // its effects. B is a NEW snippet that merely receives the tail beats: only the BEATS move down, never
  // the gating or the state changes (a copied condition silently re-gates the new bubble; copied effects
  // would fire twice). Give B a fresh snippet raw and nothing else. The terminal `jump` is a separate
  // attr and DOES belong to B - endBubble clears it on A.
  tr.setNodeMarkup(bPos, undefined, { ...b.attrs, raw: JSON.stringify({ id: newId("sn"), type: "snippet" }) });
  return { aPos, bPos };
}
