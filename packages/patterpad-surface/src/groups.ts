// ---------------------------------------------------------------------------
// Group commands (Phase C). A group is a CHUNK - a sibling of snippets in a block
// or group - so it is created at the container level, not inside a bubble. Created
// via the `/` menu's group presets (groups §4); each preset is the one underlying
// model with its selector / options pre-filled, seeded with editable content so
// the caret has somewhere to land.
//
//   insertChunk(kind) - replace the current empty bubble (or, in a non-empty
//                       snippet, drop its empty line and insert after) with a new
//                       snippet / group, caret in its first seeded bubble.
//
// Wrap / unwrap / move / delete land in later slices. Pure over EditorState.
// ---------------------------------------------------------------------------

import { Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { type Node as PMNode } from "prosemirror-model";
import { newId } from "@patterkit/core";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { cueText, prevBeatKind, emptyBeatNode, isChunk, isChoiceGroup, modelIdOf } from "./zoneutil.js";
import { landOnBeat } from "./lines.js";
import { canInsertSpecial } from "./special.js";
import { SET_MULTI } from "./multiselect.js";

/** The `/`-menu group presets (groups §4): the one model with selector/options pre-filled. */
export type GroupKind = "choice" | "if" | "sequence" | "cycle" | "shuffle";

/**
 * Marks a transaction as a STRUCTURAL move (reorder / reparent) rather than a caret
 * navigation. A move drops the selection onto the moved node so it stays visible and
 * the next move keeps working - but if that lands in a cue it must NOT be read as
 * "entered a cue", which would pop the cast popup. The harness checks this meta and
 * closes the popup instead of opening it. See moveChunk / moveNodeTo.
 */
export const STRUCTURAL_MOVE = "patterStructuralMove";

/** A fresh empty beat of the given kind, FOLLOWING the flow (text after text, dialogue after
 *  dialogue; see prevBeatKind). Delegates to the one shared builder (zoneutil.emptyBeatNode). */
const emptyBeat = emptyBeatNode;
const bubbleWith = (line: PMNode): PMNode => S.node("snippet", { raw: JSON.stringify({ id: newId("sn"), type: "snippet" }) }, [line]);
/** A fresh snippet with NO beats - an "un-entered" bubble (e.g. a branch's else leaf). It shows a
 *  generic click-to-add ghost and injects a type-following line on first click (seedBeatInSnippet). */
const emptyBubble = (): PMNode => S.node("snippet", { raw: JSON.stringify({ id: newId("sn"), type: "snippet" }) }, []);
const groupNode = (raw: object, children: PMNode[]): PMNode => S.node("group", { raw: JSON.stringify(raw) }, children);
/** A fresh option PROMPT cell (groups §13.10): defaults to an empty TEXT beat - the choice text.
 *  Accepts the inner beat's id so a caller can land the caret on the prompt it just made. */
const optionPromptNode = (id: string = newId("L")): PMNode => S.node("optionprompt", null, [S.node("prose", { id, raw: "{}" }, [S.node("say", null, [])])]);
/** An Option group: the prompt cell first, then the option's content run (§8 / §13.10). */
const optionGroup = (content: PMNode): PMNode => groupNode({ id: newId("opt"), type: "group" }, [optionPromptNode(), content]);

/** The `raw` model object (id + selector + options) for a group preset (shared by create + wrap). */
function groupRaw(kind: GroupKind): Record<string, unknown> {
  const base = { id: newId("g"), type: "group" };
  switch (kind) {
    case "choice":   return { ...base, selector: "choice" };
    case "if":       return { ...base, selector: "branch" };
    case "sequence": return { ...base, selector: "sequence", options: { order: "sequential", exhaust: "once" } };
    case "cycle":    return { ...base, selector: "sequence", options: { order: "sequential", exhaust: "repeat" } };
    case "shuffle":  return { ...base, selector: "sequence", options: { order: "shuffle", exhaust: "repeat" } };
  }
}

/** Build a seeded group of `kind`, returning the node + the beat id the caret should land on.
 *  `lineKind` makes the seeded first line follow the flow (text after text, dialogue after dialogue). */
function buildGroup(kind: GroupKind, lineKind: "line" | "prose", speaker = ""): { node: PMNode; lineId: string } {
  const line = emptyBeat(lineKind, speaker);
  const lineId = line.attrs.id as string;
  const bubble = bubbleWith(line);
  const raw = groupRaw(kind);
  if (kind === "choice") {
    // Land the caret in the option's PROMPT cell (the player-facing choice text - written first), not
    // the option BODY line, so the author types the choice label straight away (§8 / §13.10).
    const promptId = newId("L");
    const option = groupNode({ id: newId("opt"), type: "group" }, [optionPromptNode(promptId), bubble]);
    return { node: groupNode(raw, [option]), lineId: promptId };
  }
  // A branch (seeded, caret lands here) + an UN-ENTERED else: a beat-less bubble that shows a
  // click-to-add ghost and injects a type-following line on first click (§9).
  if (kind === "if") return { node: groupNode(raw, [bubble, emptyBubble()]), lineId };
  return { node: groupNode(raw, [bubble]), lineId };
}

/** True when the snippet is a single, all-empty bubble (so it can be replaced wholesale). */
function isLoneEmptyBubble(snip: PMNode): boolean {
  if (snip.childCount !== 1) return false;
  const beat = snip.firstChild!;
  if (beat.type.name !== "line" && beat.type.name !== "prose") return false;
  let empty = true;
  beat.forEach((z) => { if (z.content.size > 0) empty = false; });
  return empty;
}

/** Create a chunk (a snippet, or a group preset) at the current empty line: the `/`-menu "Follow with"
 *  (groups §4). The empty triggering line is CONSUMED - a lone empty bubble is replaced wholesale,
 *  otherwise the empty beat is dropped and the chunk lands as the next sibling - so picking /choice
 *  (etc.) never leaves the half-started line behind. */
export function insertChunk(state: EditorState, kind: "snippet" | GroupKind): Transaction | null {
  if (!canInsertSpecial(state)) return null; // only at an empty-line start
  const c = context(state);
  if (!c.snippet || !c.beat) return null;
  // Seed the new chunk's first bubble FOLLOWING the flow (text after text, dialogue after
  // dialogue) and carry the current line's speaker forward, so creating it keeps you
  // on the character selector (popup) rather than dropping a blank-speaker line under the caret.
  const lineKind = prevBeatKind(state.doc, c.beat.pos);
  const speaker = cueText(c.beat.node);
  let node: PMNode;
  let lineId: string;
  if (kind === "snippet") {
    const line = emptyBeat(lineKind, speaker);
    node = bubbleWith(line);
    lineId = line.attrs.id as string;
  } else {
    ({ node, lineId } = buildGroup(kind, lineKind, speaker));
  }

  const at = c.snippet.pos;
  const end = at + c.snippet.node.nodeSize;
  let tr: Transaction;
  if (isLoneEmptyBubble(c.snippet.node)) {
    tr = state.tr.replaceWith(at, end, node); // the whole bubble was just the empty line
  } else {
    // Drop the empty triggering line (like /jump, /action do), then drop the chunk in
    // as the next sibling - never leave a stray empty line behind in the old snippet.
    tr = state.tr.delete(c.beat.pos, c.beat.pos + c.beat.node.nodeSize);
    tr.insert(tr.mapping.map(end), node);
  }

  landOnBeat(tr, lineId); // land in the cue, speaker SELECTED - exactly like a new line
  return tr.scrollIntoView();
}

/**
 * Unwrap (remove) a group, KEEPING its content: splice its children up into the
 * parent in place (groups §7). Non-destructive; its inverse is wrapping. Net
 * parent child-count never drops, so a block can't be emptied this way.
 */
export function unwrapGroup(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "group" || node.childCount === 0) return null;
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, node.content);
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size)))).scrollIntoView();
}

/**
 * Is a chunk "effectively empty" - deleting it would destroy nothing the author typed?
 * True when its whole subtree has NO text (no cue / say content), NO action atoms, and NO
 * jump - i.e. a blank snippet, or a group whose children recurse down to only blank
 * snippets / empty groups. The action menu skips the delete confirmation for these (§7).
 */
export function chunkIsEmpty(node: PMNode): boolean {
  // ONE pass: any typed cue / say text, an action atom, or a terminal jump all count as content.
  let content = node.type.name === "snippet" && !!node.attrs.jump; // a terminal jump is content
  if (content) return false;
  node.descendants((n) => {
    if ((n.isText && (n.text?.length ?? 0) > 0) || n.type.name === "gameEvent" || (n.type.name === "snippet" && n.attrs.jump)) content = true;
    return !content; // stop descending once real content is found
  });
  return !content;
}

/**
 * Delete a chunk (a snippet OR a group) AND all its content (groups §7) - the
 * content-destroying action (the UI confirms first). Containers are `chunk*`, so the
 * last chunk may be removed: the now-empty block / group / option shows a ghost-snippet
 * placeholder (web/views.ts) instead of being re-seeded with a real bubble (D1).
 */
export function deleteChunk(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "group" && node.type.name !== "snippet")) return null;
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  return tr.scrollIntoView();
}

/**
 * Delete a BLOCK and everything in it (the block heading's menu). The doc is `block+`, so the
 * SCENE must always keep at least one block - deleting the only block is refused (null), and the
 * caller hides the action in that case. The caret lands near where the block was.
 */
export function deleteBlock(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "block") return null;
  if (state.doc.childCount <= 1) return null; // never leave a scene with zero blocks
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  return tr.scrollIntoView();
}

/**
 * Join the snippet at `pos` with its previous / next SIBLING snippet (the action menu's
 * "Join") - the inverse of a split. The two bubbles' beats merge into one; the leading
 * snippet's id / raw is kept and the terminal jump becomes the trailing snippet's (the
 * only terminal one). A no-op (null) unless the adjacent sibling is also a snippet.
 */
export function joinSnippet(state: EditorState, pos: number, dir: "up" | "down"): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "snippet") return null;
  const $pos = state.doc.resolve(pos);
  const otherIndex = $pos.index() + (dir === "up" ? -1 : 1);
  if (otherIndex < 0 || otherIndex >= $pos.parent.childCount) return null;
  const other = $pos.parent.child(otherIndex);
  if (other.type.name !== "snippet") return null;
  const aIsThis = dir === "down";              // A = the LEADING snippet (kept), B = the trailing one
  const aNode = aIsThis ? node : other, bNode = aIsThis ? other : node;
  const aPos = aIsThis ? pos : pos - other.nodeSize;
  const beats: PMNode[] = [];
  aNode.forEach((bt) => beats.push(bt)); bNode.forEach((bt) => beats.push(bt));
  const merged = S.node("snippet", { ...aNode.attrs, jump: bNode.attrs.jump }, beats); // tail's jump is terminal
  const tr = state.tr.replaceWith(aPos, aPos + aNode.nodeSize + bNode.nodeSize, merged);
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(aPos + 1, tr.doc.content.size)))).scrollIntoView();
}

/** Materialise a fresh bubble in an EMPTY container - the ghost-snippet "+" (D1). Lands
 *  the caret in its first line (the cue), exactly like starting any new snippet. */
export function seedSnippet(state: EditorState, containerPos: number): Transaction | null {
  const node = state.doc.nodeAt(containerPos);
  if (!node || (node.type.name !== "block" && node.type.name !== "group")) return null;
  // "Empty" means no CHUNK children: an option group may still hold its `optionprompt` cell, so count
  // chunks (not total childCount) and insert the fresh bubble AFTER any prompt (matching the ghost the
  // group view shows when its chunk count hits 0).
  const lead = node.firstChild?.type.name === "optionprompt" ? node.firstChild : null;
  const chunks = lead ? node.childCount - 1 : node.childCount;
  if (chunks !== 0) return null;
  const insertAt = containerPos + 1 + (lead?.nodeSize ?? 0);
  const line = emptyBeat(prevBeatKind(state.doc, insertAt)); // follow the flow
  const tr = state.tr.insert(insertAt, bubbleWith(line));
  landOnBeat(tr, line.attrs.id as string);
  return tr.scrollIntoView();
}

/**
 * Inject a fresh, type-following line into an "un-entered" snippet (a beat-less bubble - a
 * branch's else leaf, or a jump-only bubble) - the click-to-add ghost (web/views.ts, D1/§9).
 * The line is inserted at the snippet's content start (above any terminal jump, which is an
 * attr not content) and the caret lands like any new line: a dialogue line opens the cast popup.
 */
export function seedBeatInSnippet(state: EditorState, snippetPos: number): Transaction | null {
  const node = state.doc.nodeAt(snippetPos);
  if (!node || node.type.name !== "snippet") return null;
  const beat = emptyBeat(prevBeatKind(state.doc, snippetPos + 1)); // follow the flow before this bubble
  const tr = state.tr.insert(snippetPos + 1, beat); // start of the snippet's content
  landOnBeat(tr, beat.attrs.id as string);
  return tr.scrollIntoView();
}

/** The contiguous sibling chunks (snippet|group) the selection spans, at the block/group level. */
export function chunkRange(state: EditorState): { range: import("prosemirror-model").NodeRange; chunks: PMNode[] } | null {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, (p) => p.type.name === "block" || p.type.name === "group");
  if (!range) return null;
  const chunks: PMNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) chunks.push(range.parent.child(i));
  if (chunks.length === 0 || !chunks.every(isChunk)) return null;
  return { range, chunks };
}

/** The before-position of the sibling chunk (snippet|group whose parent is a block/group) that
 *  CONTAINS `pos` - the anchor a shift-click extends from. Null if `pos` isn't inside a chunk. */
export function chunkContaining(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    const parent = $pos.node(d - 1);
    if (isChunk(node) && (parent.type.name === "block" || parent.type.name === "group")) return $pos.before(d);
  }
  return null;
}

/**
 * A selection spanning the run of sibling chunks from the chunk at `anchorPos` through the chunk at
 * `headPos` (a shift-click range, groups §6). Both must be chunks under the SAME container; the PM
 * anchor stays on the anchor chunk's far edge so a further shift-click keeps extending. Null if they
 * aren't sibling chunks. (Operations read the exact node span via {@link chunkRange}, so the
 * coerced text endpoints don't matter - the decoration + delete/wrap/move all use whole chunks.)
 */
export function rangeAcrossChunks(doc: PMNode, anchorPos: number, headPos: number): Selection | null {
  const a = doc.nodeAt(anchorPos), h = doc.nodeAt(headPos);
  if (!a || !h || !isChunk(a) || !isChunk(h)) return null;
  const $a = doc.resolve(anchorPos), $h = doc.resolve(headPos);
  if ($a.depth !== $h.depth || $a.parent !== $h.parent) return null; // must be siblings
  // The anchor stays on the anchor chunk's far edge so a further shift-click keeps extending.
  // `between` walks each boundary to a selectable inline position inside the chunk, so the run reads
  // cleanly; chunkRange covers the whole run regardless.
  const fwd = headPos >= anchorPos;
  return TextSelection.between(
    doc.resolve(fwd ? anchorPos : anchorPos + a.nodeSize),
    doc.resolve(fwd ? headPos + h.nodeSize : headPos),
  );
}

/** Can the selection be wrapped? True when it spans >= 2 whole sibling chunks (the gesture, groups §5). */
export function canWrap(state: EditorState): boolean {
  if (state.selection.empty) return false;
  const cr = chunkRange(state);
  return cr !== null && cr.chunks.length >= 2;
}

/**
 * Wrap the selected contiguous chunks in a new group of `kind` (groups §5). For
 * `choice` each chunk becomes its own Option group; otherwise the chunks become
 * the group's children directly (a `tr.wrap`, which preserves the caret).
 */
export function wrapInGroup(state: EditorState, kind: GroupKind): Transaction | null {
  const cr = chunkRange(state);
  if (!cr) return null;
  const { range, chunks } = cr;
  if (kind === "choice") {
    const node = groupNode(groupRaw("choice"), chunks.map(optionGroup));
    const tr = state.tr.replaceWith(range.start, range.end, node);
    return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(range.start + 1, tr.doc.content.size)))).scrollIntoView();
  }
  // No scrollIntoView: tr.wrap keeps the existing selection. It is inside the wrapped span (already
  // on screen), and forcing a scroll-to-selection can yank the viewport - see wrapChunk below.
  return state.tr.wrap(range, [{ type: S.nodes.group, attrs: { raw: JSON.stringify(groupRaw(kind)) } }]);
}

/** Wrap a SINGLE chunk (a snippet OR a group) in a new group of `kind` - the "wrap"
 *  control on a snippet's / group's edit popover (groups §5). */
export function wrapChunk(state: EditorState, pos: number, kind: GroupKind): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "snippet" && node.type.name !== "group")) return null;
  const $from = state.doc.resolve(pos);
  const $to = state.doc.resolve(pos + node.nodeSize);
  const range = $from.blockRange($to, (p) => p.type.name === "block" || p.type.name === "group");
  if (!range) return null;
  if (kind === "choice") {
    const choice = groupNode(groupRaw("choice"), [optionGroup(node)]); // a one-option choice to grow from
    const tr = state.tr.replaceWith(range.start, range.end, choice);
    return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(range.start + 1, tr.doc.content.size)))).scrollIntoView();
  }
  // tr.wrap KEEPS the existing caret - which may be far from this chunk (you wrap from its ⋯ menu
  // while the caret sits elsewhere, e.g. up the script). scrollIntoView would then yank the viewport
  // to that caret (the "scrolls back to the top" bug). Omit it: the caret-beat recentre (main.ts)
  // still gently follows the caret when it IS in the wrapped chunk; otherwise the viewport stays put.
  return state.tr.wrap(range, [{ type: S.nodes.group, attrs: { raw: JSON.stringify(groupRaw(kind)) } }]);
}

/** Set / clear a snippet's eligibility condition (the per-snippet "condition" chrome). */
export function setSnippetCondition(state: EditorState, snippetPos: number, condition: string): Transaction | null {
  const snip = state.doc.nodeAt(snippetPos);
  if (!snip || snip.type.name !== "snippet") return null;
  const raw = JSON.parse(snip.attrs.raw) as Record<string, unknown>;
  const c = condition.trim();
  if (c) raw.condition = c; else delete raw.condition;
  return state.tr.setNodeMarkup(snippetPos, undefined, { ...snip.attrs, raw: JSON.stringify(raw) }).scrollIntoView();
}

/**
 * Insert a prompt cell at the front of a choice OPTION that has none (the quick-fix for a
 * `missing-prompt` flow error). No-op (null) if the node isn't an option group or already leads
 * with a prompt. The new cell is empty for the author to type the choice text into.
 */
export function addOptionPrompt(state: EditorState, optionPos: number): Transaction | null {
  const node = state.doc.nodeAt(optionPos);
  if (!node || node.type.name !== "group") return null;
  if (node.firstChild?.type.name === "optionprompt") return null; // already has a prompt
  return state.tr.insert(optionPos + 1, optionPromptNode()).scrollIntoView();
}

/** One effect overlaid on a snippet's `raw` (mirrors the model's Effect). SET-ONLY (spec §15):
 *  an effect is a property mutation; host event emission rides on gameData, not effects. */
export type SnippetEffect = { kind: "set"; target: string; value: string };

/**
 * Replace a snippet's `onEnter` / `onExit` effect list (the per-snippet outcome
 * chrome). The fields live in the snippet's `raw` overlay; an empty list is
 * stored as omission.
 */
export function setSnippetEffects(
  state: EditorState, snippetPos: number, phase: "onEnter" | "onExit", effects: SnippetEffect[],
): Transaction | null {
  const snip = state.doc.nodeAt(snippetPos);
  if (!snip || snip.type.name !== "snippet") return null;
  const raw = JSON.parse(snip.attrs.raw) as Record<string, unknown>;
  const norm = effects.map((e) => ({ kind: "set", target: e.target, value: e.value }));
  if (norm.length) raw[phase] = norm; else delete raw[phase];
  return state.tr.setNodeMarkup(snippetPos, undefined, { ...snip.attrs, raw: JSON.stringify(raw) });
}

/** Editable group properties (the header access-UI, groups §9). */
export interface GroupPropsPatch {
  selector?: "run" | "branch" | "sequence" | "choice";
  order?: "sequential" | "shuffle";
  exhaust?: "once" | "repeat" | "stick";
  condition?: string;
  /** Option-position field (a choice's child, groups §8). The option's `prompt` (the
   *  choice text) is a beat edited inline as a tied cell, NOT through this patch (§13.10). */
  secretUntilEligible?: boolean;
  /** Option-position (spec §5): repeatable. Default false = once-only (gone after one use). */
  sticky?: boolean;
  /** Option-position (spec §5): the choice's fallback. Setting it true clears it on the sibling
   *  options (at most one fallback per choice). */
  fallback?: boolean;
}

/**
 * Patch a group's behaviour - selector, the `sequence` order x exhaust, and the
 * eligibility condition (groups §9). The fields live in the group's `raw` overlay,
 * so this rewrites that attr. `run` / empty condition are stored as omission.
 */
export function setGroupProps(state: EditorState, pos: number, patch: GroupPropsPatch): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "group") return null;
  const raw = JSON.parse(node.attrs.raw) as Record<string, unknown>;

  if (patch.selector !== undefined) {
    if (patch.selector === "run") delete raw.selector; else raw.selector = patch.selector;
    if (patch.selector === "sequence") raw.options = raw.options ?? { order: "sequential", exhaust: "once" };
    else delete raw.options; // options only mean something for `sequence`
  }
  if (patch.order !== undefined || patch.exhaust !== undefined) {
    const o = (raw.options as { order?: string; exhaust?: string } | undefined) ?? { order: "sequential", exhaust: "once" };
    raw.options = { order: patch.order ?? o.order ?? "sequential", exhaust: patch.exhaust ?? o.exhaust ?? "once" };
  }
  if (patch.condition !== undefined) {
    if (patch.condition.trim() === "") delete raw.condition; else raw.condition = patch.condition;
  }
  if (patch.secretUntilEligible !== undefined) {
    if (patch.secretUntilEligible) raw.secretUntilEligible = true; else delete raw.secretUntilEligible;
  }
  if (patch.sticky !== undefined) {
    if (patch.sticky) raw.sticky = true; else delete raw.sticky;
  }
  if (patch.fallback !== undefined) {
    if (patch.fallback) raw.fallback = true; else delete raw.fallback;
  }
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw: JSON.stringify(raw) });
  // At most one fallback per choice: turning one on clears it on its sibling options (setNodeMarkup
  // keeps node sizes, so the sibling positions stay valid alongside this one).
  if (patch.fallback === true) clearSiblingFallback(state, tr, pos);
  return tr;
}

/** Clear `fallback` on every sibling option of the one at `optionPos` (single-fallback invariant). */
function clearSiblingFallback(state: EditorState, tr: Transaction, optionPos: number): void {
  const $opt = state.doc.resolve(optionPos);
  let childPos = $opt.start(); // first child of the enclosing choice
  $opt.parent.forEach((child) => {
    if (childPos !== optionPos && child.type.name === "group") {
      const r = JSON.parse(child.attrs.raw as string) as Record<string, unknown>;
      if (r.fallback === true) { delete r.fallback; tr.setNodeMarkup(childPos, undefined, { ...child.attrs, raw: JSON.stringify(r) }); }
    }
    childPos += child.nodeSize;
  });
}

/**
 * Insert a fresh chunk right AFTER the chunk at `pos` - a plain snippet, or a seeded
 * group of `kind` (the snippet's "+ add after" and the action menu's "Add after").
 * Lands the caret in the new chunk's first line (its cue, like any new line).
 */
export function insertAfter(state: EditorState, pos: number, kind: "snippet" | GroupKind): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "snippet" && node.type.name !== "group")) return null;
  const at = pos + node.nodeSize; // the seam just after this chunk
  const lineKind = prevBeatKind(state.doc, at); // follow the flow at the seam
  if (kind === "snippet") {
    const line = emptyBeat(lineKind);
    const tr = state.tr.insert(at, bubbleWith(line));
    landOnBeat(tr, line.attrs.id as string);
    return tr.scrollIntoView();
  }
  const { node: group, lineId } = buildGroup(kind, lineKind);
  const tr = state.tr.insert(at, group);
  landOnBeat(tr, lineId);
  return tr.scrollIntoView();
}

/** Append a fresh Option group (a seeded bubble) to a choice (groups §8). */
export function insertOption(state: EditorState, choicePos: number): Transaction | null {
  const node = state.doc.nodeAt(choicePos);
  if (!node || !isChoiceGroup(node)) return null;
  // The option's CONTENT follows the snippet BEFORE the whole choice - not the option prompt (always
  // text, so unhelpful) nor a sibling option's content. Measure from the choice's own position.
  const line = emptyBeat(prevBeatKind(state.doc, choicePos));
  const option = optionGroup(bubbleWith(line)); // prompt cell + a seeded content bubble (§13.10)
  const tr = state.tr.insert(choicePos + node.nodeSize - 1, option); // just inside the choice's end
  landOnBeat(tr, line.attrs.id as string); // dialogue lands in the cue (popup); text in content
  return tr.scrollIntoView();
}

/** Insert a fresh Option group right AFTER the given option (the per-option "+ option",
 *  mirroring how "+ block" adds after a block). Only valid on a choice's direct child. */
export function insertOptionAfter(state: EditorState, optionPos: number): Transaction | null {
  const node = state.doc.nodeAt(optionPos);
  if (!node || node.type.name !== "group") return null;
  const $opt = state.doc.resolve(optionPos);
  if (!isChoiceGroup($opt.parent)) return null;
  // Follow the snippet BEFORE the whole choice (its position), not the prompt or a sibling option.
  const line = emptyBeat(prevBeatKind(state.doc, $opt.before($opt.depth)));
  const option = optionGroup(bubbleWith(line)); // prompt cell + a seeded content bubble (§13.10)
  const tr = state.tr.insert(optionPos + node.nodeSize, option); // after this option
  landOnBeat(tr, line.attrs.id as string); // dialogue lands in the cue (popup); text in content
  return tr.scrollIntoView();
}

/**
 * Reorder a node (a bubble, a group, or a block) among its siblings (groups §6) -
 * the keyboard-free move that drag-and-drop will later also drive. Swaps with the
 * previous / next sibling; a no-op at the container's edge.
 */
export function moveChunk(state: EditorState, pos: number, dir: "up" | "down"): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || !["snippet", "group", "block"].includes(node.type.name)) return null;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const target = dir === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= $pos.parent.childCount) return null; // already at the edge

  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const insertAt = dir === "up"
    ? pos - $pos.parent.child(index - 1).nodeSize                                   // before the previous sibling
    : tr.mapping.map(pos + node.nodeSize + $pos.parent.child(index + 1).nodeSize);  // after the next sibling
  tr.insert(insertAt, node);
  tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1))).scrollIntoView();
  return tr.setMeta(STRUCTURAL_MOVE, true);
}

/**
 * True when dropping the node at `fromPos` at `toSeam` would UNWRAP an Option - i.e. an
 * Option (a group that is a choice's direct child) dragged to a NON-choice parent, where
 * an option is meaningless. The drag layer confirms before committing this (it dissolves
 * the option, splicing its content into the target). Mirrors moveNodeTo's own guards.
 */
export function dropUnwrapsOption(state: EditorState, fromPos: number, toSeam: number): boolean {
  const node = state.doc.nodeAt(fromPos);
  if (!node || node.type.name !== "group") return false;
  if (!isChoiceGroup(state.doc.resolve(fromPos).parent)) return false;          // not an option
  if (toSeam > fromPos && toSeam < fromPos + node.nodeSize) return false;
  if (toSeam === fromPos || toSeam === fromPos + node.nodeSize) return false;
  return !isChoiceGroup(state.doc.resolve(toSeam).parent);                       // leaving for a non-choice parent
}

/**
 * Move a node (bubble / group / block) to an arbitrary sibling SEAM (groups §6) -
 * reorder within a container OR reparent into / out of a group. This is the engine
 * drag-and-drop drives. Refuses a drop into the node's own subtree, a no-op on its
 * own seams, and a type-mismatched target (a block only between blocks; a chunk
 * only between chunks). Containers are `chunk*`, so moving the last chunk out of a
 * block / group leaves it empty (a ghost-snippet placeholder shows there) - no re-seed (D1).
 *
 * Choice-aware (§8): a choice's children must be Options, so a non-option chunk dropped
 * INTO a choice is WRAPPED in a fresh Option; and an Option dragged OUT to a non-choice
 * parent is UNWRAPPED (its content splices in). An Option moved into another choice (or
 * reordered within one) stays an Option.
 */
export function moveNodeTo(state: EditorState, fromPos: number, toSeam: number): Transaction | null {
  const node = state.doc.nodeAt(fromPos);
  if (!node || !["snippet", "group", "block"].includes(node.type.name)) return null;
  if (toSeam > fromPos && toSeam < fromPos + node.nodeSize) return null;       // into its own subtree
  if (toSeam === fromPos || toSeam === fromPos + node.nodeSize) return null;   // its own seams: no-op
  const toParent = state.doc.resolve(toSeam).parent;
  const parentType = toParent.type.name;
  const valid = node.type.name === "block" ? parentType === "doc" : (parentType === "block" || parentType === "group");
  if (!valid) return null;

  const destIsChoice = isChoiceGroup(toParent);
  const fromIsOption = node.type.name === "group" && isChoiceGroup(state.doc.resolve(fromPos).parent);
  let content: PMNode | readonly PMNode[];
  if (fromIsOption && !destIsChoice) {                          // unwrap: splice the option's CONTENT out
    const kids: PMNode[] = [];                                  // (its prompt cell is dropped - it is meaningless outside a choice)
    node.forEach((ch) => { if (ch.type.name !== "optionprompt") kids.push(ch); });
    content = kids;
  } else if (!fromIsOption && destIsChoice) {
    content = optionGroup(node);                                // wrap: a choice's children must be options
  } else {
    content = node;                                             // move as-is (incl. option -> choice)
  }

  const tr = state.tr.delete(fromPos, fromPos + node.nodeSize);
  const insertAt = tr.mapping.map(toSeam);
  tr.insert(insertAt, content);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size)))).scrollIntoView();
  return tr.setMeta(STRUCTURAL_MOVE, true);
}

/**
 * Move a contiguous RUN of sibling chunks (a shift-click multi-selection, groups §6) to a seam, as
 * one unit - reorder within the container or reparent into another block/group, keeping the run whole
 * and re-selected. `fromStart`..`fromEnd` is the run's node span (chunkRange's range.start/.end).
 * Refuses a drop inside the run's own span, into a non-chunk container, or across a CHOICE boundary
 * (per-chunk option wrap/unwrap is left to the single-node move - a run stays a run).
 */
export function moveRangeTo(state: EditorState, fromStart: number, fromEnd: number, toSeam: number): Transaction | null {
  if (toSeam > fromStart && toSeam < fromEnd) return null;        // inside the run's own span
  if (toSeam === fromStart || toSeam === fromEnd) return null;    // its own edges: no-op
  const nodes: PMNode[] = [];
  state.doc.slice(fromStart, fromEnd).content.forEach((n) => nodes.push(n));
  if (nodes.length < 2 || !nodes.every(isChunk)) return null;
  const toParent = state.doc.resolve(toSeam).parent;
  if (toParent.type.name !== "block" && toParent.type.name !== "group") return null;
  // Keep the run whole: only same-kind containers (refuse crossing a choice boundary, which would
  // need each chunk individually wrapped into / unwrapped out of an Option).
  if (isChoiceGroup(toParent) !== isChoiceGroup(state.doc.resolve(fromStart).parent)) return null;
  const tr = state.tr.delete(fromStart, fromEnd);
  const insertAt = tr.mapping.map(toSeam);
  tr.insert(insertAt, nodes);
  let total = 0; for (const n of nodes) total += n.nodeSize;
  // Re-select the moved run (so it stays highlighted) via the inline-searching helper - never the raw
  // boundary positions (TextSelection.create wouldn't search and would warn on a node boundary).
  const reselect = rangeAcrossChunks(tr.doc, insertAt, insertAt + total - nodes[nodes.length - 1]!.nodeSize);
  if (reselect) tr.setSelection(reselect);
  return tr.setMeta(STRUCTURAL_MOVE, true).scrollIntoView();
}

// --- discontiguous multi-select (a Cmd-click set, possibly with gaps) operations (groups §6) -------
// These take a list of sibling chunk POSITIONS and act on them as a set, GATHERING when there are gaps
// (a wrap / move of [1,2,4] pulls those three together; 3 stays behind). Positions are processed
// high->low so each stays valid against the original doc as earlier (higher) ones are removed.

const chunkNodesAt = (doc: PMNode, positions: number[]): PMNode[] =>
  positions.map((p) => doc.nodeAt(p)).filter((n): n is PMNode => !!n && isChunk(n));

/** Delete every chunk in the set (deepest position first, so the rest stay valid). */
export function deleteChunksAt(state: EditorState, positions: number[]): Transaction | null {
  if (positions.length === 0) return null;
  const tr = state.tr;
  for (const p of [...positions].sort((a, b) => b - a)) {
    const n = state.doc.nodeAt(p);
    if (n && isChunk(n)) tr.delete(p, p + n.nodeSize);
  }
  const at = Math.min(positions[0]!, tr.doc.content.size);
  return tr.setSelection(Selection.near(tr.doc.resolve(at))).scrollIntoView();
}

/** Wrap the set in a new group of `kind`, gathered at the lowest position (gaps are left behind). */
export function wrapChunksAt(state: EditorState, positions: number[], kind: GroupKind): Transaction | null {
  const sorted = [...positions].sort((a, b) => a - b);
  const nodes = chunkNodesAt(state.doc, sorted);
  if (nodes.length < 2) return null;
  const at = sorted[0]!;
  const tr = state.tr;
  for (const p of [...sorted].sort((a, b) => b - a)) { const n = state.doc.nodeAt(p); if (n) tr.delete(p, p + n.nodeSize); }
  const content = kind === "choice" ? nodes.map(optionGroup) : nodes;
  tr.insert(at, groupNode(groupRaw(kind), content)); // `at` (the lowest) is unshifted by the higher deletes
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size)))).scrollIntoView();
}

/** Move the whole set to `toSeam` (gathered, in order); keeps them multi-selected after the move. */
export function moveChunksAt(state: EditorState, positions: number[], toSeam: number): Transaction | null {
  const sorted = [...positions].sort((a, b) => a - b);
  const nodes = chunkNodesAt(state.doc, sorted);
  if (nodes.length < 2) return null;
  for (const p of sorted) { const n = state.doc.nodeAt(p)!; if (toSeam > p && toSeam < p + n.nodeSize) return null; } // inside a selected chunk
  const toParent = state.doc.resolve(toSeam).parent;
  if (toParent.type.name !== "block" && toParent.type.name !== "group") return null;
  if (isChoiceGroup(toParent) !== isChoiceGroup(state.doc.resolve(sorted[0]!).parent)) return null; // don't cross a choice as a set
  const tr = state.tr;
  for (const p of [...sorted].sort((a, b) => b - a)) { const n = state.doc.nodeAt(p); if (n) tr.delete(p, p + n.nodeSize); }
  const insertAt = tr.mapping.map(toSeam);
  tr.insert(insertAt, nodes);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size)))).scrollIntoView();
  return tr.setMeta(STRUCTURAL_MOVE, true).setMeta(SET_MULTI, { ids: nodes.map((n) => modelIdOf(n) ?? ""), anchor: (modelIdOf(nodes[0]!) ?? "") });
}

/** Rename a block (its name is the H1 heading AND the jump-target label). */
export function setBlockName(state: EditorState, pos: number, name: string): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "block") return null;
  const raw = JSON.parse(node.attrs.raw) as Record<string, unknown>;
  raw.name = name;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, raw: JSON.stringify(raw) });
}

/** Insert a fresh, named block after the one at `pos`, caret on its bubble's first line. */
export function insertBlock(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "block") return null;
  const line = emptyBeat(prevBeatKind(state.doc, pos + node.nodeSize)); // follow the flow
  const block = S.node("block", { raw: JSON.stringify({ id: newId("blk"), type: "block", name: "New section" }) }, [bubbleWith(line)]);
  const tr = state.tr.insert(pos + node.nodeSize, block);
  landOnBeat(tr, line.attrs.id as string); // a new snippet starts a new line: land in the cue (selector opens)
  return tr.scrollIntoView();
}
