// ---------------------------------------------------------------------------
// Special-line insertion (Z8, spec section 10). Jumps and actions are
// INSERTED at an empty line via the slash menu - never reached by toggling - and
// removed only via their per-line delete affordance.
//
//   insertJump(target) - set the current snippet's terminal jump (a snippet-
//                  level value, not a beat); the triggering empty line is dropped
//                  and a fresh bubble follows with the caret in it.
//   setSnippetJump(pos, target|null) - set / change / clear a snippet's jump
//                  directly (the bottom-right chrome control), no bubble churn.
//   insertGameEvent    - the current empty line becomes a game-event beat; it does
//                  NOT end the bubble; a fresh line follows with the caret in it.
//                  (The game-event details UI is deferred to the shell.)
//   deleteAtomAt(pos)  - remove a game-event node (the UI affordance). The jump is
//                  removed via setSnippetJump(.., null) instead.
//
// Targets / details come from the shell; these commands are pure over state.
// ---------------------------------------------------------------------------

import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { newId } from "@patterkit/core";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { cueText, prevBeatKind, emptyBeatNode, findBeatById, zoneContentEnd } from "./zoneutil.js";
import { landOnBeat } from "./lines.js";

/** Is the cursor on an empty line where the slash menu is allowed (content-start, or in the cue)? */
export function canInsertSpecial(state: EditorState): boolean {
  const c = context(state);
  if (!c.beat || (c.beat.kind !== "line" && c.beat.kind !== "prose") || !c.zone) return false;
  let sayLen = 1;
  c.beat.node.forEach((z) => { if (z.type.name === "say") sayLen = z.content.size; });
  return sayLen === 0 && (c.zone.role === "cue" || c.zone.atStart);
}

/**
 * Commit a jump at the triggering empty line. A jump is TERMINAL (the last thing a bubble does),
 * so behaviour depends on where the empty line sits:
 *   - ON THE LAST LINE (nothing after it): the jump just becomes THIS snippet's jump in place,
 *     REPLACING any existing one - no split, no new bubble. The caret eases to the last content beat.
 *   - MID-BUBBLE (content after it): the snippet SPLITS - snippet A (this one, the beats before) takes
 *     the NEW jump; snippet B (the beats split away) inherits the OLD jump, so the continuing
 *     content keeps the snippet's original terminal routing. The caret lands on B's content.
 * Either way the triggering empty line is dropped.
 */
export function insertJump(state: EditorState, target: string): Transaction | null {
  if (!canInsertSpecial(state)) return null; // only at an empty-line start
  const c = context(state);
  if (!c.beat || !c.snippet) return null;
  const A = c.snippet.node;
  const oldJump = A.attrs.jump as string; // the snippet's existing terminal jump ("" if none)
  // Split at the triggering empty line (which is itself dropped): before -> this bubble, after -> the next.
  const before: PMNode[] = [];
  const after: PMNode[] = [];
  let seen = false;
  A.forEach((ch) => {
    if (ch === c.beat!.node) { seen = true; return; } // drop the empty triggering line
    (seen ? after : before).push(ch);
  });
  const newA = S.node("snippet", { ...A.attrs, jump: JSON.stringify({ to: target }) }, Fragment.fromArray(before));

  if (after.length > 0) {
    // Mid-bubble SPLIT: the trailing beats become snippet B, inheriting the OLD jump; land on its
    // first content beat so the author can keep editing the continuation.
    const newB = S.node("snippet", { raw: JSON.stringify({ id: newId("sn"), type: "snippet" }), jump: oldJump }, Fragment.fromArray(after));
    const tr = state.tr.replaceWith(c.snippet.pos, c.snippet.pos + A.nodeSize, Fragment.fromArray([newA, newB]));
    const landId = (after.find((b) => b.type.name === "line" || b.type.name === "prose")?.attrs.id as string) ?? "";
    if (landId) landOnBeat(tr, landId);
    return tr.scrollIntoView();
  }

  // LAST LINE: just set/replace THIS snippet's jump in place (drop the empty triggering line) - no
  // split, no fresh bubble. The caret eases to the end of the last remaining content beat.
  const tr = state.tr.replaceWith(c.snippet.pos, c.snippet.pos + A.nodeSize, newA);
  const last = [...before].reverse().find((b) => b.type.name === "line" || b.type.name === "prose");
  if (last) {
    const ref = findBeatById(tr.doc, last.attrs.id as string);
    const end = ref ? zoneContentEnd(ref.node, ref.pos, "say") : -1;
    if (end >= 0) tr.setSelection(TextSelection.create(tr.doc, end));
  }
  return tr.scrollIntoView();
}

/** Set / change / clear a snippet's terminal jump directly (the bottom-right chrome).
 *  `mode` sets the divert kind: "jump" (one-way, the default) or "call" (jump-and-return). Passing
 *  it undefined KEEPS whatever mode was there (a plain re-target), so the inspector's target picker and
 *  its go/call toggle stay independent. */
export function setSnippetJump(state: EditorState, snippetPos: number, target: string | null, mode?: "jump" | "call"): Transaction | null {
  const snip = state.doc.nodeAt(snippetPos);
  if (!snip || snip.type.name !== "snippet") return null;
  const prev = snip.attrs.jump ? (JSON.parse(snip.attrs.jump) as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...prev, to: target }; // keep mode/raw on a re-target
  if (mode === "call") next.mode = "call";
  else if (mode === "jump") delete next.mode; // one-way is the default; omit it from the file
  const jump = target ? JSON.stringify(next) : ""; // "" clears the jump entirely
  const tr = state.tr.setNodeMarkup(snippetPos, undefined, { ...snip.attrs, jump });
  // Adding a jump to an EMPTY bubble makes it a jump-only snippet - drop the placeholder beat(s) so it
  // collapses to the slim divert row (a beat-less snippet + jump). Only when the content is wholly empty;
  // a bubble with any real text keeps its beats. The "add a line" ghost can re-grow it later.
  if (target && snip.content.size > 0 && snip.textContent.trim() === "") {
    tr.delete(snippetPos + 1, snippetPos + 1 + snip.content.size);
  }
  return tr.scrollIntoView();
}

/** Insert a game event at the current empty line; a fresh line follows in the same bubble. */
export function insertGameEvent(state: EditorState): Transaction | null {
  if (!canInsertSpecial(state)) return null; // only at an empty-line start
  const c = context(state);
  if (!c.beat) return null;
  const action = S.node("gameEvent", { id: newId("A"), raw: "{}" });
  // The fresh trailing line reads like any new line, FOLLOWING the flow: carry the current
  // speaker and (for dialogue) land in the cue so the character selector opens.
  const speaker = cueText(c.beat.node);
  const freshId = newId("L");
  const fresh = emptyBeatNode(prevBeatKind(state.doc, c.beat.pos), speaker, freshId);
  const tr = state.tr.replaceWith(c.beat.pos, c.beat.pos + c.beat.node.nodeSize, Fragment.fromArray([action, fresh]));
  landOnBeat(tr, freshId);
  return tr.scrollIntoView();
}

/** Delete the game-event node at `pos` (the per-beat affordance). */
export function deleteAtomAt(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "gameEvent") return null;
  return state.tr.delete(pos, pos + node.nodeSize).scrollIntoView();
}
