// ---------------------------------------------------------------------------
// Speaker qualifiers (design/proposals/speaker-qualifiers.md §3): `TAM (O.S.)`.
// A line's qualifier is the `gameId` of one of the project's qualifiers, stored on
// the line beat beside its direction. In the doc it rides in the line's `raw`
// overlay (bridge.ts keeps every field it does not rebuild from zones), so it
// round-trips with no bridge change; the cue draws it from a decoration the
// qualifier plugin lays on the cue (web/qualifiers.ts, web/views.ts).
//
// Runs inherit it, when a line is added: a new line by a character takes the
// qualifier of the nearest earlier line by the same character anywhere in the
// scene, in document order, and "none" on that line means none. The same rule
// runs when the character of a blank line is set or changed. The result is
// written onto the line: nothing is inherited at runtime, and a line by another
// character, or with no character yet, takes nothing.
// ---------------------------------------------------------------------------

import type { Command, EditorState, Transaction } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { isHistoryTransaction } from "prosemirror-history";
import { context } from "./context.js";
import { BEAT_TYPES, cueText, sayText, rawAttr, editsInsideTextblocks } from "./zoneutil.js";

/** Transaction meta: the lines this transaction adds are copies (Duplicate), which keep the qualifier
 *  they were copied with rather than inheriting one. */
export const NO_INHERIT = "patterNoQualifierInherit";

/** A line's qualifier gameId, or undefined for none (and for anything that is not a line). */
export function qualifierOf(node: PMNode): string | undefined {
  if (node.type.name !== "line") return undefined;
  const q = rawAttr(node).qualifier;
  return typeof q === "string" && q ? q : undefined;
}

/** A line's `raw` overlay with its qualifier set, or dropped for none. */
export function rawWithQualifier(raw: unknown, qualifier: string | undefined): string {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") { try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = {}; } }
  if (qualifier) obj.qualifier = qualifier; else delete obj.qualifier;
  return JSON.stringify(obj);
}

/** A `raw` overlay with no qualifier: what a line keeps when it becomes text (a text beat has none). */
export const rawWithoutQualifier = (raw: unknown): string => rawWithQualifier(raw, undefined);

/** Set (or clear, with undefined / "") the qualifier of the line at `pos`. Null when there is no line
 *  there or it already has that qualifier. */
export function setQualifierAt(state: EditorState, pos: number, qualifier: string | undefined): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "line") return null;
  const want = qualifier || undefined;
  if (qualifierOf(node) === want) return null;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw: rawWithQualifier(node.attrs.raw, want) });
}

/** The qualifier after `current` when cycling: none, then each of the list in order, then none again.
 *  One that is not in the list (removed from the project) moves on to the first. */
export function nextQualifier(list: readonly string[], current: string | undefined): string | undefined {
  const i = current === undefined ? -1 : list.indexOf(current);
  return list[i + 1];
}

/** The keyboard route: cycle the caret's line (or line prompt) through the project's qualifiers, then
 *  none. `list` is the project's gameIds in display order. False when the caret is not on a line or the
 *  project has no qualifiers. */
export const cycleQualifier = (list: readonly string[]): Command => (state, dispatch) => {
  const c = context(state);
  if (!c.beat || c.beat.kind !== "line" || list.length === 0) return false;
  if (dispatch) {
    const tr = setQualifierAt(state, c.beat.pos, nextQualifier(list, qualifierOf(c.beat.node)));
    if (tr) dispatch(tr);
  }
  return true;
};

/** Does any step of `tr` replace text inside a cue (a name picked, typed, or cleared)? */
function touchesCue(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    if (!(step instanceof ReplaceStep)) return false;
    const { from } = step as unknown as { from: number };
    return tr.docs[i]!.resolve(from).parent.type.name === "cue";
  });
}

/** Every beat in `doc` by id: a line's cue text, or null for a beat that is not a line. */
function beatCues(doc: PMNode): Map<string, string | null> {
  const out = new Map<string, string | null>();
  doc.descendants((node) => {
    if (!BEAT_TYPES.has(node.type.name)) return true;
    const id = node.attrs.id;
    if (typeof id === "string") out.set(id, node.type.name === "line" ? cueText(node) : null);
    return false;
  });
  return out;
}

/**
 * The inheritance rule, as an appended transaction (web/qualifiers.ts): after `trs` took `oldState` to
 * `newState`, every line that is NEW (its id was nowhere in the old doc), or is BLANK (no words yet) and
 * had its speaker set or changed, takes the qualifier of the nearest earlier line by the same speaker,
 * or none when that line has none or there is no such line. Null when nothing needs to change.
 *
 * Undo / redo, and a Duplicate (NO_INHERIT), are left alone: they restore or copy lines whose qualifier
 * is already what it should be. Typing in a say or a direction adds no line and touches no speaker, so
 * the common keystroke returns before any walk.
 */
export function inheritQualifiers(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  if (!trs.some((t) => t.docChanged)) return null;
  if (trs.some((t) => isHistoryTransaction(t) || t.getMeta(NO_INHERIT))) return null;
  if (trs.every((t) => !t.docChanged || (editsInsideTextblocks(t) && !touchesCue(t)))) return null;

  const before = beatCues(oldState.doc);
  // Pass 1: the lines the rule applies to, and the speakers they need a history for.
  const targets = new Set<string>();
  const speakers = new Set<string>();
  newState.doc.descendants((node) => {
    if (!BEAT_TYPES.has(node.type.name)) return true;
    if (node.type.name !== "line") return false;
    const id = node.attrs.id as string;
    const cue = cueText(node);
    if (!cue) return false; // no speaker yet: nothing to inherit from
    const isNew = !before.has(id);
    const respoken = !isNew && before.get(id) !== cue && sayText(node) === "";
    if (isNew || respoken) { targets.add(id); speakers.add(cue); }
    return false;
  });
  if (targets.size === 0) return null;

  // Pass 2, in document order: each speaker's qualifier on their latest line so far. A target takes it,
  // and then counts as that speaker's latest line itself (so a run of new lines carries it down).
  const latest = new Map<string, string | undefined>();
  let tr: Transaction | null = null;
  newState.doc.descendants((node, pos) => {
    if (!BEAT_TYPES.has(node.type.name)) return true;
    if (node.type.name !== "line") return false;
    const cue = cueText(node);
    if (!speakers.has(cue)) return false;
    let q = qualifierOf(node);
    if (targets.has(node.attrs.id as string)) {
      const want = latest.get(cue);
      if (want !== q) {
        tr ??= newState.tr;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw: rawWithQualifier(node.attrs.raw, want) }); // same size: later positions hold
        q = want;
      }
    }
    latest.set(cue, q);
    return false;
  });
  return tr;
}
