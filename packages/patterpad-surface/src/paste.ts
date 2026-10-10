// ---------------------------------------------------------------------------
// Paste and copy as text (review 2026-10, ruling E). No node in the schema has a
// parse rule - a beat needs an id, and a dialogue line a speaker, that no
// clipboard can supply - so ProseMirror's own paste glued paragraphs into one run,
// pasted a copied speaker as spoken words, and threw on a copy across two beats.
// The surface takes paste over instead (web/clipboard.ts reads the clipboard into
// PARAGRAPHS of marked inline text) and this module places them:
//
//   one paragraph            -> into the field at the caret, like typing
//   several, in a bubble     -> the first joins the line at the caret; each further
//                               one becomes a new TEXT beat with a fresh id after
//                               it; the words that followed the caret move to the
//                               end of the last one (a split, as Enter makes)
//   several, in a prompt     -> joined with spaces: a choice prompt is one line and
//                               no beat can follow it
//   in a direction           -> joined, plain (a direction is never formatted)
//   in a speaker name        -> refused: the name is a token the cast popup owns
//   a selected bubble        -> new text beats at its end; a selected game event:
//                               new text beats after it
//
// Copying writes plain text the same way round: one line per beat, the spoken
// words only (never the speaker or the direction), so a copied line pastes as its
// text anywhere, in this editor or another application.
// ---------------------------------------------------------------------------

import { NodeSelection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Fragment, type Node as PMNode, type Slice } from "prosemirror-model";
import { patterSchema as S } from "./schema.js";
import { beatNode, sayText } from "./zoneutil.js";
import { movePad } from "./pad.js";

/** The plain text a copied slice puts on the clipboard: one line per beat, spoken words only. */
export function clipboardText(slice: Slice): string {
  const lines: string[] = [];
  let run = ""; // text copied from inside a single zone (an open slice whose top level is text)
  const walk = (frag: Fragment): void => {
    frag.forEach((node) => {
      const t = node.type.name;
      if (node.isText) { run += node.text ?? ""; return; }
      if (t === "line" || t === "prose") { lines.push(sayText(node)); return; }
      if (t === "say") { lines.push(node.textContent); return; }
      if (t === "cue" || t === "paren" || t === "gameEvent" || t === "rawnode") return;
      walk(node.content);
    });
  };
  walk(slice.content);
  if (run) lines.unshift(run);
  return lines.join("\n");
}

/** Plain text to paragraphs: one per non-blank line (a blank line between paragraphs is just a gap). */
export function textParagraphs(text: string): Fragment[] {
  return text.split(/\r\n?|\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 0).map((l) => Fragment.from(S.text(l)));
}

const plain = (f: Fragment): Fragment => {
  const out: PMNode[] = [];
  f.forEach((n) => { if (n.isText && n.text) out.push(S.text(n.text)); });
  return Fragment.fromArray(out);
};

/** The paragraphs joined into one run with a space between (for a field that holds one line). */
function joined(paras: Fragment[]): Fragment {
  let out = Fragment.empty;
  paras.forEach((p, i) => { out = i === 0 ? p : out.append(Fragment.from(S.text(" "))).append(p); });
  return out;
}

/** Fresh text beats, one per paragraph. */
const proseBeats = (paras: Fragment[]): PMNode[] => paras.map((p) => beatNode("prose", { say: p }));

/** The caret at the end of the say of the beat at `beatPos` in `tr.doc`, less `back` characters. */
function caretInSay(tr: Transaction, beatPos: number, back = 0): void {
  const beat = tr.doc.nodeAt(beatPos);
  if (!beat) return;
  let end = -1;
  beat.forEach((z, off) => { if (z.type.name === "say") end = beatPos + 1 + off + 1 + z.content.size; });
  if (end >= 0) tr.setSelection(TextSelection.create(tr.doc, end - back));
}

/**
 * Place pasted paragraphs at the selection (see the module header). `formatting` false strips bold /
 * italic, as the project ships plain strings then. Null when the paste is refused here; a range that
 * would drop structure is refused by the structure guard when the transaction is dispatched.
 */
export function pasteParagraphs(state: EditorState, paragraphs: Fragment[], formatting: boolean): Transaction | null {
  const paras = (formatting ? paragraphs : paragraphs.map(plain)).filter((p) => p.size > 0);
  if (!paras.length) return null;
  const sel = state.selection;

  if (sel instanceof NodeSelection) {
    const { node, from } = sel;
    const at = node.type.name === "snippet" ? from + node.nodeSize - 1 : node.type.name === "gameEvent" ? from + node.nodeSize : -1;
    if (at < 0) return null; // a selected group or block: nothing sensible to paste over
    const beats = proseBeats(paras);
    const tr = state.tr.insert(at, beats);
    caretInSay(tr, at + beats.slice(0, -1).reduce((n, b) => n + b.nodeSize, 0));
    return tr.scrollIntoView();
  }

  // A range never takes a game event with it (as deleteSelectionGuarded), however it is replaced.
  let hasAtom = false;
  state.doc.nodesBetween(sel.from, sel.to, (n) => { if (n.type.name === "gameEvent") hasAtom = true; return !hasAtom; });
  if (hasAtom) return null;

  const tr = state.tr;
  if (!sel.empty) tr.deleteSelection();
  const $at = tr.selection.$from;
  const zone = $at.parent.type.name;
  if (zone === "cue") return null;
  if (zone === "paren") return tr.insertText(paras.map((p) => p.textBetween(0, p.size)).join(" "), $at.pos).scrollIntoView();
  if (zone !== "say") return null;

  // Where a new beat may go: a say inside a snippet. A prompt (no snippet around it) takes one line.
  let snippetDepth = -1;
  for (let d = $at.depth; d >= 0; d--) if ($at.node(d).type.name === "snippet") { snippetDepth = d; break; }
  if (paras.length === 1 || snippetDepth < 0) {
    const content = joined(paras);
    tr.insert($at.pos, content);
    return tr.setSelection(TextSelection.create(tr.doc, $at.pos + content.size)).scrollIntoView();
  }

  // Several paragraphs in a bubble: split here, as Enter does, with the new text beats in between.
  const beatDepth = $at.depth - 1;
  const beatEnd = $at.after(beatDepth);
  const tail = $at.parent.content.cut($at.parentOffset);
  const sayEnd = $at.end();
  const mark = tr.steps.length; // map only through the steps taken from here on
  tr.delete($at.pos, sayEnd).insert($at.pos, paras[0]!);
  const rest = paras.slice(1);
  rest[rest.length - 1] = rest[rest.length - 1]!.append(tail);
  const beats = proseBeats(rest);
  const insertAt = tr.mapping.slice(mark).map(beatEnd);
  tr.insert(insertAt, beats);
  const lastPos = insertAt + beats.slice(0, -1).reduce((n, b) => n + b.nodeSize, 0);
  // The words after the caret now end the last new beat, and the pause after them goes with them.
  if (tail.size > 0) movePad(tr, $at.before(beatDepth), lastPos);
  caretInSay(tr, lastPos, tail.size);
  return tr.scrollIntoView();
}
