// ---------------------------------------------------------------------------
// Line padding (design/proposals/line-padding.md): the pause after a line or text
// beat, `padAfter`, in seconds, and the `padAfterDefault` a snippet, group, block,
// or scene gives the beats inside it that set none. Both ride in the node's `raw`
// overlay, so the bridge carries them with no change of its own.
//
// The edits that rebuild a beat decide where its pause goes. The pause belongs to
// the END of a line, so when one line's words end another's (a merge), the merged
// line takes the pause of the line whose end it now has (a blank line has no end
// to give, so the line it joins keeps its own); when a line is split, the pause
// goes with the tail. A snippet split gives the tail bubble the same default, so
// the lines that move keep their timing.
//
// When lines come under a different default (a bubble joined or merged into
// another, a group's default gone with an ungroup), one rule holds. If none of
// the moved lines sets its own pause, they simply take the new default. If any
// does, the writer has been timing them, so all of them keep their timing: the
// own pauses stay, and each line that set none is pinned to the pause it had.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { isHistoryTransaction } from "prosemirror-history";
import { DEFAULT_PAD_AFTER } from "@patterkit/model";
import { rawAttr, isZoneBeat, modelIdOf, editsInsideTextblocks, findBeatsByIds } from "./zoneutil.js";

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

const projectPadKey = new PluginKey<() => number | undefined>("patterProjectPad");

/** Tells the surface's commands the project's default pause (what a beat plays with when nothing in the
 *  scene sets one), so the pause a moved line is pinned to is the one it really had. Without it they
 *  take DEFAULT_PAD_AFTER. */
export function projectPad(get: () => number | undefined): Plugin {
  return new Plugin({ key: projectPadKey, state: { init: () => get, apply: (_tr, get) => get } });
}

/** The project's default pause, as the host gives it (projectPad), else DEFAULT_PAD_AFTER. */
export const projectPadOf = (state: EditorState): number => projectPadKey.getState(state)?.() ?? DEFAULT_PAD_AFTER;

/** The pause the line or text beat at `pos` in `doc` plays with: its own, else the nearest default above
 *  it, else `project`. A snippet's last line or text beat can't cut in across the seam, so a negative
 *  pause there is none (the runtime's clamp). Undefined when there's no such beat at `pos`. */
export function resolvedPadAt(doc: PMNode, pos: number, project: number): number | undefined {
  const beat = doc.nodeAt(pos);
  if (!beat || !isZoneBeat(beat)) return undefined;
  const $pos = doc.resolve(pos);
  let pad = padOf(beat);
  for (let d = $pos.depth; pad === undefined && d >= 0; d--) pad = padDefaultOf($pos.node(d));
  pad ??= project;
  return pad < 0 && $pos.parent.type.name === "snippet" && endsSnippet($pos.parent, beat) ? 0 : pad;
}

/** A line about to come under a different default: its id, the pause it plays with now, and whether
 *  that pause is its own. */
export interface MovedLine { id: string; before: number; own: boolean }

/** Every line or text beat inside `node` (at `pos` in `doc`), as a MovedLine, in document order. */
export function linesIn(doc: PMNode, node: PMNode, pos: number, project: number): MovedLine[] {
  const out: MovedLine[] = [];
  node.descendants((n, off) => {
    if (!isZoneBeat(n)) return true;
    const id = modelIdOf(n);
    const before = resolvedPadAt(doc, pos + 1 + off, project);
    if (id && before !== undefined) out.push({ id, before, own: padOf(n) !== undefined });
    return false;
  });
  return out;
}

/** The rule for lines that moved under a different default, applied in `tr` (see the header): when any
 *  of `moved` that is still in `tr.doc` sets its own pause, each one that sets none and would now play
 *  differently is pinned to the pause it had. Lines the edit deleted count for nothing; every change
 *  keeps each beat's size, so positions hold. */
export function keepMovedTiming(tr: Transaction, moved: readonly MovedLine[], project: number): void {
  const now = findBeatsByIds(tr.doc, new Set(moved.map((m) => m.id)));
  const kept = moved.filter((m) => now.has(m.id));
  if (!kept.some((m) => m.own)) return; // all inherit: they take the new default
  for (const m of kept) {
    const at = now.get(m.id)!;
    if (m.own || resolvedPadAt(tr.doc, at.pos, project) === m.before) continue;
    tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, raw: rawWithPad(at.node.attrs.raw, m.before) });
  }
}

/** Every snippet in `doc` by model id, with its position. */
function snippetsById(doc: PMNode): Map<string, { node: PMNode; pos: number }> {
  const out = new Map<string, { node: PMNode; pos: number }>();
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === "snippet") { const id = modelIdOf(node); if (id) out.set(id, { node, pos }); return false; }
    return t === "doc" || t === "block" || t === "group";
  });
  return out;
}

/**
 * The same rule for the edits no command of ours builds: a range delete, a cut, or typing over a
 * selection that runs from one bubble into the next joins the rest of the second bubble's lines onto the
 * first (ProseMirror's own join). An appended transaction finds a bubble that went while some of its
 * lines stayed, and keeps their timing. Commands that apply the rule themselves (Join, the merges, and
 * ungroup) leave nothing for it to do, and undo / redo restore what was there.
 */
export function keepTimingOnJoin(): Plugin {
  return new Plugin({
    key: new PluginKey("patterKeepTimingOnJoin"),
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((t) => t.docChanged) || trs.some(isHistoryTransaction)) return null;
      if (trs.every((t) => !t.docChanged || editsInsideTextblocks(t))) return null;
      const after = snippetsById(newState.doc);
      const project = projectPadOf(newState);
      const moved: MovedLine[] = [];
      for (const [id, { node, pos }] of snippetsById(oldState.doc)) {
        if (!after.has(id)) moved.push(...linesIn(oldState.doc, node, pos, project));
      }
      if (!moved.length) return null;
      const tr = newState.tr;
      keepMovedTiming(tr, moved, project);
      return tr.docChanged ? tr : null;
    },
  });
}
