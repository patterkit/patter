// ---------------------------------------------------------------------------
// Line padding (design/proposals/line-padding.md): the pause after a line or text
// beat, `padAfter`, in seconds, and the `padAfterDefault` a snippet, group, block,
// or scene gives the beats inside it that set none. Both ride in the node's `raw`
// overlay, so the bridge carries them with no change of its own.
//
// The edits that rebuild a beat decide where its pause goes. The pause belongs to
// the END of a line, so when one line's words end another's (a merge), the merged
// line takes the pause of the line whose end it now has; when a line is split, the
// pause goes with the tail. A snippet split gives the tail bubble the same default,
// so the lines that move keep their timing.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { rawAttr, isZoneBeat } from "./zoneutil.js";

/** A finite number, else undefined (what a hand-edited `raw` may hold instead). */
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A line or text beat's own `padAfter`, or undefined when it sets none (or isn't a line or text beat). */
export function padOf(beat: PMNode): number | undefined {
  return isZoneBeat(beat) ? num(rawAttr(beat).padAfter) : undefined;
}

/** A container's own `padAfterDefault` (snippet, group, block, or the scene's doc), or undefined. */
export function padDefaultOf(node: PMNode): number | undefined {
  return num(rawAttr(node).padAfterDefault);
}

/** A `raw` overlay with `key` set to `value`, or dropped for undefined. */
function rawWith(raw: unknown, key: "padAfter" | "padAfterDefault", value: number | undefined): string {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") { try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = {}; } }
  if (value === undefined) delete obj[key]; else obj[key] = value;
  return JSON.stringify(obj);
}

/** A beat's `raw` overlay with its `padAfter` set, or dropped for undefined. */
export const rawWithPad = (raw: unknown, pad: number | undefined): string => rawWith(raw, "padAfter", pad);
/** A container's `raw` overlay with its `padAfterDefault` set, or dropped for undefined. */
export const rawWithPadDefault = (raw: unknown, pad: number | undefined): string => rawWith(raw, "padAfterDefault", pad);

/** `beat` rebuilt with the pause of `from` (its own value, or none). Used when `beat` takes over the end
 *  of `from`'s words, so the pause that followed them still does. A copy only when it changes. */
export function withPadOf(beat: PMNode, from: PMNode): PMNode {
  const want = padOf(from);
  if (padOf(beat) === want) return beat;
  return beat.type.create({ ...beat.attrs, raw: rawWithPad(beat.attrs.raw, want) }, beat.content, beat.marks);
}

/** Move the pause of the beat at `fromPos` onto the beat at `toPos` (a split's tail), in `tr`. Nothing
 *  happens when the first sets none. Both positions are in `tr.doc`; both beats keep their size. */
export function movePad(tr: Transaction, fromPos: number, toPos: number): void {
  const from = tr.doc.nodeAt(fromPos), to = tr.doc.nodeAt(toPos);
  if (!from || !to) return;
  const pad = padOf(from);
  if (pad === undefined) return;
  tr.setNodeMarkup(toPos, undefined, { ...to.attrs, raw: rawWithPad(to.attrs.raw, pad) });
  tr.setNodeMarkup(fromPos, undefined, { ...from.attrs, raw: rawWithPad(from.attrs.raw, undefined) });
}

/** Set (or clear, with undefined) the `padAfter` of the line or text beat at `pos`. Null when there's no
 *  such beat there, or it already has that value. */
export function setPadAt(state: EditorState, pos: number, pad: number | undefined): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || !isZoneBeat(node) || padOf(node) === pad) return null;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw: rawWithPad(node.attrs.raw, pad) });
}

/** Is the line or text beat `beat` the last line or text beat of the snippet `snippet`? The runtime
 *  clamps a negative pause there to zero (it can't cut in across the seam). */
export function endsSnippet(snippet: PMNode, beat: PMNode): boolean {
  let last: PMNode | null = null;
  snippet.forEach((b) => { if (isZoneBeat(b)) last = b; });
  return last === beat;
}

/** Is the line or text beat `beat` followed straight away by a game event in `snippet`? A cut-in can't cross
 *  the event, so the runtime clamps a negative pause there to zero too. */
export function beforeGameEvent(snippet: PMNode, beat: PMNode): boolean {
  let found = false;
  let next: PMNode | null = null;
  snippet.forEach((b) => { if (found && next === null) next = b; if (b === beat) found = true; });
  return next !== null && (next as PMNode).type.name === "gameEvent";
}
