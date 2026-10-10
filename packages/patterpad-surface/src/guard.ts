// ---------------------------------------------------------------------------
// The structure guard (review 2026-10, ruling D). A snippet carries logic - a
// condition, onEnter / onExit effects, a terminal jump - and a group IS logic (a
// choice, a branch, a sequence). ProseMirror's own joins and range replaces know
// nothing of that: deleting across a bubble boundary keeps the first snippet's
// attributes and silently drops the second's, and a range that runs into a choice
// removes the whole choice. So every transaction passes through one filter here,
// which refuses it when it would make a logic-carrying snippet, or any group,
// disappear, and hands the host a short sentence naming what would be lost. A
// snippet's own default pause (line padding) is no reason to refuse: when its
// lines land in another bubble, they keep their timing by the rule in pad.ts.
//
// One filter covers every route at once - Backspace and Delete merges, a range
// delete, typing over a selection, cut, paste, and drop - because they all arrive
// as replace steps. Deliberate structural commands (delete a chunk, ungroup, a
// move) mark their transaction with ALLOW_STRUCTURE and pass; so do undo / redo.
//
// The test is "is the node still there afterwards", by model id, rather than a
// reading of which boundary a step closed: a move deletes a node and inserts it
// again, and a plain merge of two bare bubbles loses an id that carried nothing,
// and both of those must go through.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import { isHistoryTransaction } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import { isChoiceGroup, modelIdOf, rawAttr } from "./zoneutil.js";

/** Transaction meta: this transaction removes structure on purpose (the author asked for it through a
 *  menu, a confirm, or a drag), so the guard lets it through. */
export const ALLOW_STRUCTURE = "patterAllowStructure";

/** Transaction meta carrying a refusal sentence. A pure command that declines for a reason the author
 *  should hear dispatches an otherwise empty transaction with this meta; the guard reports the sentence
 *  to the host and drops the transaction. */
export const REFUSED = "patterRefused";

/** A meta-only transaction that, through the guard, tells the host why `state` was left alone. */
export const refusal = (state: EditorState, message: string): Transaction => state.tr.setMeta(REFUSED, message);

/** The logic a snippet carries, as the words a refusal names it by ("a condition", "effects", "a jump"). */
export function snippetLogic(node: PMNode): string[] {
  if (node.type.name !== "snippet") return [];
  const raw = rawAttr(node);
  const out: string[] = [];
  if (typeof raw.condition === "string" && raw.condition.trim()) out.push("a condition");
  const hasEffects = (k: string): boolean => Array.isArray(raw[k]) && (raw[k] as unknown[]).length > 0;
  if (hasEffects("onEnter") || hasEffects("onExit")) out.push("effects");
  if (node.attrs.jump) out.push("a jump");
  return out;
}

/** "a", "a and b", "a, b, and c" (the house style's Oxford comma). */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The noun a group goes by in a refusal: what the author sees on its rail. */
function groupNoun(node: PMNode, parent: PMNode | null): string {
  if (isChoiceGroup(parent)) return "option";
  const raw = rawAttr(node);
  if (raw.selector === "choice") return "choice";
  if (raw.selector === "branch") return "branch";
  if (raw.selector === "sequence") return "sequence";
  return "group";
}

/** The sentence for a snippet whose logic an edit would drop. `subject` is "This bubble", "The next
 *  bubble" and so on. Null when the snippet carries no logic (nothing to protect). */
export function snippetLossMessage(subject: string, node: PMNode): string | null {
  const logic = snippetLogic(node);
  if (!logic.length) return null;
  const pronoun = logic.length > 1 || logic[0] === "effects" ? "them" : "it";
  return `${subject} has ${listOf(logic)}. Move or clear ${pronoun} first.`;
}

/** The sentence for a group an edit would remove wholesale. */
function groupLossMessage(subject: string): string {
  return `${subject} would be lost. To remove it, use Delete on its menu.`;
}

interface Candidate { node: PMNode; parent: PMNode | null; pos: number }

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** How a refusal refers to the lost node, from where the edit started: the node the selection starts
 *  in is "this", one after the selection is "the next", one inside a range is "a ... in the selection". */
function subjectFor(c: Candidate, noun: string, state: EditorState): string {
  const { from, to, empty } = state.selection;
  const end = c.pos + c.node.nodeSize;
  if (from > c.pos && from < end) return `This ${noun}`;
  if (c.pos >= to || empty) return `The next ${noun}`;
  return capitalise(`a ${noun} in the selection`);
}

/** Every snippet / group id present in `doc` (one walk over the containers, never into beats). */
function chunkIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const t = node.type.name;
    if (t === "snippet" || t === "group") { const id = modelIdOf(node); if (id) ids.add(id); return t === "group"; }
    return t === "block";
  });
  return ids;
}

/**
 * Why `tr` must be refused, or null when it may go ahead. Exported for tests and for callers that want
 * to ask before dispatching; the plugin below is what enforces it.
 */
export function structureLoss(tr: Transaction, state: EditorState): string | null {
  const meta = tr.getMeta(REFUSED);
  if (typeof meta === "string") return meta;
  if (!tr.docChanged) return null;
  if (tr.getMeta(ALLOW_STRUCTURE) || isHistoryTransaction(tr)) return null;

  // The snippets and groups any step's removed range reaches. A step that stays inside one textblock
  // (all ordinary typing) cannot touch a container, so it is skipped without a walk.
  const candidates = new Map<string, Candidate>();
  tr.steps.forEach((step, i) => {
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return;
    const { from, to } = step as unknown as { from: number; to: number };
    if (from >= to) return; // a pure insertion removes nothing
    const doc = tr.docs[i]!;
    const $from = doc.resolve(from), $to = doc.resolve(to);
    if ($from.sameParent($to) && $from.parent.inlineContent) return;
    const back = i === 0 ? null : tr.mapping.slice(0, i).invert();
    doc.nodesBetween(from, to, (node, pos, parent) => {
      const t = node.type.name;
      if (t !== "snippet" && t !== "group") return t === "doc" || t === "block";
      const id = modelIdOf(node);
      if (id && !candidates.has(id)) candidates.set(id, { node, parent, pos: back ? back.map(pos) : pos });
      return t === "group";
    });
  });
  if (!candidates.size) return null;

  const after = chunkIds(tr.doc);
  const lost = [...candidates.entries()].filter(([id]) => !after.has(id)).map(([, c]) => c).sort((a, b) => a.pos - b.pos);
  // A lost group outranks the snippets inside it: the group is what the author would be losing.
  const group = lost.find((c) => c.node.type.name === "group");
  if (group) return groupLossMessage(subjectFor(group, groupNoun(group.node, group.parent), state));
  for (const c of lost) {
    const msg = snippetLossMessage(subjectFor(c, "bubble", state), c.node);
    if (msg) return msg;
  }
  return null;
}

/**
 * The guard plugin. `report` receives each refusal sentence (the surface passes the host's toast); it
 * runs once per refused transaction.
 */
export function structureGuard(report: (message: string) => void = () => {}): Plugin {
  return new Plugin({
    key: new PluginKey("patterStructureGuard"),
    filterTransaction(tr, state) {
      const why = structureLoss(tr, state);
      if (why == null) return true;
      report(why);
      return false;
    },
  });
}
