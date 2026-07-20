// Node views for the zone-model surface (DOM-dependent, under web/). Renders the
// zones inline as script - CHARACTER: (direction) content - with the cue tinted
// by character colour and the parens/colon as chrome. Functional baseline for the
// re-model; the fully themed set is the shell's, and richer fidelity returns as
// the zone slices land.

import type { NodeViewConstructor, EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { selectChunkAt } from "./chunkselect.js";
import type { Node as PMNode } from "prosemirror-model";
import { colourFor } from "../src/colour.js";
import { deleteAtomAt } from "../src/special.js";
import { setBlockName, insertBlock, insertOptionAfter, seedSnippet, seedBeatInSnippet } from "../src/groups.js";
import { groupLabel } from "../src/grouplabel.js";
import { createActionMenu } from "./actionmenu.js";
import { makeDragHandle } from "./dnd.js";
import { modelIdOf, isChoiceGroup, rawAttr } from "../src/zoneutil.js";

type View = import("prosemirror-view").EditorView;
type GetPos = () => number | undefined;

// The jump chip shows a READABLE address, not the opaque internal id it stores. The host injects a
// resolver (id -> readable label: a block / scene name, or its gameId); default is identity (the id).
let resolveJumpLabel: (id: string) => string = (id) => id;
export function setJumpLabelResolver(fn: (id: string) => string): void { resolveJumpLabel = fn; }

// Double-clicking a jump chip follows the divert to its target (the host switches scene if needed and
// reveals the node). The host injects the navigator; default is a no-op (an embedder with no routing).
let jumpNav: ((targetId: string) => void) | null = null;
export function setJumpNavHandler(fn: ((targetId: string) => void) | null): void { jumpNav = fn; }

// A jump chip's label is the TARGET's scene / block title - resolved at paint time. Renaming that
// target doesn't touch the snippet holding the jump, so ProseMirror never re-runs its node view and the
// label would go stale. Each jump chip registers a re-resolver here; the host calls refreshJumpLabels()
// after a rename (block heading / scene title) to repaint every chip with the new name.
const jumpRefreshers = new Set<() => void>();
export function refreshJumpLabels(): void { for (const fn of jumpRefreshers) fn(); }

// The visit-counting functions (`visits` / `seen`, and their world-wide `patter_` variants) take a
// node id - the same opaque id a jump targets. The author never wants to read `visits("blk_x7q2")`;
// the read-only condition tag swaps that id for the scene / block TITLE via the same resolver the jump
// chips use, so it reads `if visits(The Tavern) > 0`. The id is accepted BOTH quoted (`visits("blk_x")`)
// AND as a bareword (`visits(blk_x)`): the dialect parses a bareword arg as the same string literal, so
// both forms are valid and equivalent - humanize either.
const VISIT_FN_RE = /\b(patter_visits|patter_seen|visits|seen)\s*\(\s*(?:(['"])(.*?)\2|([A-Za-z_]\w*))\s*\)/g;
export function humanizeCondition(c: string): string {
  return c.replace(VISIT_FN_RE, (_m, fn: string, _q: string | undefined, quotedId: string | undefined, bareId: string | undefined) =>
    `${fn}(${resolveJumpLabel(quotedId ?? bareId ?? "")})`);
}

// One shared structural action menu (⋯ / right-click), created lazily on first use.
let actionMenu: ReturnType<typeof createActionMenu> | null = null;
const menu = (): ReturnType<typeof createActionMenu> => (actionMenu ??= createActionMenu());

/** Open the shared action menu for a SCENE (the title right-click, surface.ts): a note-only menu carrying
 *  the scene id, so it offers "Note…" and the writing-status submenu (which ripples to the whole scene). */
export function openSceneMenu(view: View, at: { x: number; y: number }, sceneId: string): void {
  menu().open(view, () => undefined, at, "note", { id: sceneId, kind: "scene" });
}

/** The quiet ⋯ control (Slack / Docs style) that opens the structural action menu. */
function menuButton(view: View, getPos: GetPos): HTMLButtonElement {
  const b = document.createElement("button"); b.className = "menu-dots"; b.textContent = "⋯"; b.dataset.tip = "actions"; b.setAttribute("aria-label", "actions"); b.contentEditable = "false";
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); menu().open(view, getPos, b); });
  return b;
}

/**
 * ignoreMutation for a node view that has CHROME around its contentDOM. ProseMirror's DOM
 * observer otherwise treats any attribute / child change on the wrapper (a drag "make-room"
 * class, our hover controls, the read-only tags) as foreign and REDRAWS the node - which
 * silently reverts that class mid-drag. We tell PM to ignore everything outside the editable
 * content (but never the selection, and never real edits inside contentDOM).
 */
function ignoreChrome(contentDOM: HTMLElement): (m: MutationRecord | { type: "selection" }) => boolean {
  return (m) => m.type === "selection" ? false : !contentDOM.contains((m as MutationRecord).target);
}

/** Wire right-click on `el` to open the same structural menu at the pointer. */
function wireContextMenu(el: HTMLElement, view: View, getPos: GetPos): void {
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); menu().open(view, getPos, { x: e.clientX, y: e.clientY }); });
}

/** Wire right-click on `el` to open the NOTE-only menu ("Note…") for the node at `getPos` - for nodes
 *  with no structural menu of their own: the block heading (#148 notes redesign). */
function wireNoteMenu(el: HTMLElement, view: View, getPos: GetPos): void {
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); menu().open(view, getPos, { x: e.clientX, y: e.clientY }, "note"); });
}

/** Wire right-click on a BEAT to open the full structural menu of its ENCLOSING SNIPPET (so split /
 *  follow-with / delete still act on the bubble - room for beat-level structural actions later), but
 *  with "Note…" re-targeted to THIS beat (beat-aware notes, #148/§18). */
function wireBeatMenu(el: HTMLElement, view: View, getPos: GetPos): void {
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault(); e.stopPropagation();
    const bp = getPos(); if (bp == null) return;
    const beat = view.state.doc.nodeAt(bp); const id = beat ? modelIdOf(beat) : null;
    const note = id ? { id, kind: beat!.type.name } : null;
    const snippetPos: GetPos = () => {
      const p = getPos(); if (p == null) return undefined;
      const $p = view.state.doc.resolve(p);
      for (let d = $p.depth; d >= 1; d--) if ($p.node(d).type.name === "snippet") return $p.before(d);
      return p;
    };
    menu().open(view, snippetPos, { x: e.clientX, y: e.clientY }, "full", note);
  });
}

/** The ghost placeholder shown in an EMPTY container (block / group / option) OR an un-entered,
 *  beat-less snippet: a faint dashed outline + a centred "+". Clicking runs `seed` to materialise
 *  content - `seedSnippet` for a container (a fresh bubble, D1), `seedBeatInSnippet` for a beat-less
 *  bubble (a type-following line, §9). */
function ghostSnippet(
  view: View, getPos: GetPos,
  seed: (state: View["state"], pos: number) => import("prosemirror-state").Transaction | null = seedSnippet,
  title = "add a snippet",
): HTMLElement {
  const g = document.createElement("div"); g.className = "ghost-snippet"; g.contentEditable = "false"; g.dataset.tip = title;
  const plus = document.createElement("span"); plus.className = "ghost-plus"; plus.textContent = "+";
  g.appendChild(plus);
  g.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); const pos = getPos(); if (pos == null) return; const tr = seed(view.state, pos); if (tr) view.dispatch(tr); view.focus(); });
  return g;
}

/** The discreet "+" that adds a following sibling chunk (the kinds menu), mirroring
 *  "+ block" / "+ option" - it lives centred in the gap after a snippet. */
function addAfterButton(view: View, getPos: GetPos): HTMLButtonElement {
  // No "+" text glyph: the cross is drawn with CSS pseudo-bars (.bubble-after::before/::after)
  // so it is GEOMETRICALLY centred, not subject to a font's math-axis offset.
  const b = document.createElement("button"); b.className = "snippet-ctl add-after"; b.dataset.tip = "follow with"; b.setAttribute("aria-label", "follow with"); b.contentEditable = "false";
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); menu().open(view, getPos, b, "add"); });
  return b;
}

// --- zones -------------------------------------------------------------------

// A wrapped dialogue line hangs under its first content zone (direction if present, else content) -
// both begin right after the cue, so the hang point is the cue's width. The cue is variable (name,
// font, reading size, the "<character>:" placeholder), so we MEASURE it and feed --cue-w to the
// hanging-indent CSS (styles.css .beat.kind-line).
//   The cue is an INLINE box, so ResizeObserver's border-box size reports 0 (and won't re-fire on a
//   name change); we read getBoundingClientRect instead. The measure runs from three places: the
//   cueView update (name/placeholder changed), document.fonts.ready (webfont swap widens it), and a
//   remeasureCues() the font/size toggles call (no document edit fires there).
function measureCue(cue: HTMLElement): void {
  const beat = cue.closest(".beat") as HTMLElement | null;
  if (!beat) return;
  const w = cue.getBoundingClientRect().width;
  if (w > 0) beat.style.setProperty("--cue-w", `${w}px`); // 0 == not laid out yet; a later pass corrects it
}

/** Defer to after layout (the cue isn't measurable until inserted / repainted). */
function scheduleCueMeasure(cue: HTMLElement): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => measureCue(cue));
  else measureCue(cue);
}

/** Remeasure every cue - for changes that shift widths without a document edit (reading-size or
 *  font-theme switch, late webfont load). Called by main.ts's font/size toggles and on fonts.ready. */
export function remeasureCues(): void {
  for (const cue of document.querySelectorAll<HTMLElement>(".zone.cue")) measureCue(cue);
}
if (typeof document !== "undefined" && document.fonts) void document.fonts.ready.then(remeasureCues);

export const cueView: NodeViewConstructor = (node) => {
  const dom = document.createElement("span"); dom.className = "zone cue";
  const content = document.createElement("span"); content.className = "cue-text";
  const colon = document.createElement("span"); colon.className = "cue-colon"; colon.contentEditable = "false"; colon.textContent = ":";
  dom.append(content, colon);
  const paint = (n: typeof node): void => {
    const name = n.textContent;
    content.style.color = name ? colourFor(name) : "var(--muted)";
    colon.style.display = name ? "" : "none";
    dom.classList.toggle("empty", name.length === 0);
  };
  paint(node);
  scheduleCueMeasure(dom);
  let lastMeasured = node.textContent; // the name the --cue-w width was last measured for
  return { dom, contentDOM: content, update: (n) => {
    if (n.type.name !== "cue") return false;
    paint(n);
    // Only remeasure when the NAME changed - the width tracks the text, so a sibling edit / selection
    // update repainting the cue must not schedule a layout read every keystroke. (Font / reading-size
    // changes go through remeasureCues(), and fonts.ready handles the late webfont swap.)
    if (n.textContent !== lastMeasured) { lastMeasured = n.textContent; scheduleCueMeasure(dom); }
    return true;
  } };
};

export const parenView: NodeViewConstructor = () => {
  // Real "(" ")" siblings (not ::before/::after), so the caret sits BETWEEN them
  // in the editable content rather than in front of a generated pseudo-element.
  const dom = document.createElement("span"); dom.className = "zone paren";
  const open = document.createElement("span"); open.className = "paren-chrome"; open.contentEditable = "false"; open.textContent = "(";
  const content = document.createElement("span"); content.className = "paren-text";
  const close = document.createElement("span"); close.className = "paren-chrome"; close.contentEditable = "false"; close.textContent = ")";
  dom.append(open, content, close);
  return { dom, contentDOM: content };
};

export const sayView: NodeViewConstructor = () => {
  // An inner `.say-text` (like cue/paren) is the editable contentDOM, so an EMPTY
  // say can be made inline-block with a min-width caret target while the trailing
  // <br> is hidden - giving the caret a real box at the content start (right of the
  // cue/colon gap) instead of a degenerate position that paints back at the colon.
  const dom = document.createElement("span"); dom.className = "zone say";
  const content = document.createElement("span"); content.className = "say-text";
  dom.appendChild(content);
  return { dom, contentDOM: content };
};

// --- beats -------------------------------------------------------------------

export const lineView: NodeViewConstructor = (_node, view, getPos) => {
  const dom = document.createElement("div"); dom.className = "beat kind-line";
  // Right-click opens the enclosing snippet's structural menu, with "Note…" re-targeted to this beat.
  // The cue observer writes --cue-w onto this beat; tell PM an attribute mutation here is our chrome.
  wireBeatMenu(dom, view, getPos);
  return { dom, contentDOM: dom, ignoreMutation: (m) => m.type === "attributes" };
};

export const proseView: NodeViewConstructor = (_node, view, getPos) => {
  const dom = document.createElement("div"); dom.className = "beat kind-prose";
  // As with lineView: ignore attribute mutations (play marker / squiggles); the snippet's structural
  // menu on right-click, with a beat-targeted "Note…".
  wireBeatMenu(dom, view, getPos);
  return { dom, contentDOM: dom, ignoreMutation: (m) => m.type === "attributes" };
};

/** A choice option's PROMPT cell (groups §13.10): the tied choice-text line, in distinct chrome
 *  so it reads as "the label, content expected below". Holds one line / prose beat. */
export const optionpromptView: NodeViewConstructor = () => {
  const dom = document.createElement("div"); dom.className = "option-prompt";
  const body = document.createElement("div"); body.className = "option-prompt-body";
  dom.append(body);
  return { dom, contentDOM: body };
};

// --- the action atom, with a delete affordance (spec §10) --------------------

function atomDeleteButton(view: import("prosemirror-view").EditorView, getPos: () => number | undefined): HTMLButtonElement {
  const del = document.createElement("button"); del.className = "atom-del"; del.textContent = "×"; del.dataset.tip = "delete"; del.setAttribute("aria-label", "delete");
  del.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const pos = getPos();
    if (pos != null) { const tr = deleteAtomAt(view.state, pos); if (tr) view.dispatch(tr); }
  });
  return del;
}

export const gameEventView: NodeViewConstructor = (_node, view, getPos) => {
  const dom = document.createElement("div"); dom.className = "beat kind-gameEvent"; dom.contentEditable = "false";
  const glyph = document.createElement("span"); glyph.className = "atom-glyph"; glyph.textContent = "⚙ game event";
  dom.append(glyph, atomDeleteButton(view, getPos));
  // A game event is an atom with no caret position: clicking it node-selects it so it visibly reads as the
  // current object (PM adds .ProseMirror-selectednode) and the inspector reflects it.
  dom.addEventListener("mousedown", (e) => selectNodeOnClick(e, view, getPos));
  wireBeatMenu(dom, view, getPos); // right-click → snippet menu with a beat-targeted "Note…" (no VO/loc on a game event)
  // Ignore attribute mutations (the play-marker `.playing` / `.visited` classes, node-selection class)
  // so PM keeps our chrome instead of redrawing the atom and stripping it.
  return { dom, ignoreMutation: (m) => m.type === "attributes" };
};

/** Node-select the node at `getPos` on a chrome click, so it reads as the selected object + drives the
 *  inspector. Skips clicks on inner controls (delete button, etc.). A CHUNK (snippet / group) goes
 *  through the multi-select-aware {@link selectChunkAt} (shift / cmd build a set, groups §6); any other
 *  selectable node - a GAME-EVENT atom - is plain node-selected (it isn't part of the chunk set). */
function selectNodeOnClick(e: MouseEvent, view: EditorView, getPos: () => number | undefined): void {
  if (e.button !== 0 || (e.target as Element).closest("button")) return;
  const pos = getPos();
  if (pos == null) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  e.preventDefault();
  if (node.type.name === "snippet" || node.type.name === "group") {
    selectChunkAt(view, pos, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
  } else {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); // e.g. an action atom
    view.focus();
  }
}

// --- bubble + group container ------------------------------------------------

/** A chunk's stable model id (from `raw`), tagged on its DOM so a drop can FLIP-animate it
 *  (match the same chunk's element before / after ProseMirror re-renders the move). "" when absent. */
const idOf = (n: PMNode): string => modelIdOf(n) ?? "";

/**
 * A snippet = a bubble. Chrome is collapsed to the minimum (D3-D5): a quiet ⋯ action
 * menu rides the top-right of the first text line (the content reserves space so it
 * never wraps under it), a drag grip in the left gutter, and READ-ONLY data signals -
 * an `if …` condition tag (top, only when set) and a `↪ target` jump chip (bottom,
 * only when set; the bottom space appears with it). Editing that data is the inspector
 * pane's job; right-click or the ⋯ open the same structural menu.
 */
export const snippetView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement("div"); dom.className = "bubble"; dom.dataset.id = idOf(node);
  const drag = makeDragHandle(view, getPos); drag.classList.add("bubble-drag"); // left gutter, hover-revealed
  const dots = menuButton(view, getPos); dots.classList.add("bubble-menu");       // ⋯ rides the first text line, top-right
  const cond = document.createElement("div"); cond.className = "bubble-cond"; cond.contentEditable = "false"; // read-only condition tag
  const contentDOM = document.createElement("div"); contentDOM.className = "beats";
  const jump = document.createElement("div"); jump.className = "bubble-jump"; jump.contentEditable = "false"; // read-only jump chip
  // An un-entered (beat-less) bubble - a branch's else leaf, or a jump-only bubble - shows a
  // generic click-to-add ghost; the click injects a type-following line above any jump (§9).
  const ghost = ghostSnippet(view, getPos, seedBeatInSnippet, "add a line"); ghost.classList.add("bubble-ghost");
  const addAfter = addAfterButton(view, getPos); addAfter.classList.add("bubble-after"); // "+" in the gap below
  dom.append(drag, dots, cond, contentDOM, ghost, jump, addAfter);
  // Clicking anywhere on the bubble that ISN'T an editable beat, the ghost, the drag grip, or a button
  // selects the whole snippet - its border / padding, the gaps around the beats, the read-only
  // condition / jump chrome. A generous hit target (the thin gutter alone was too hard to land).
  dom.addEventListener("mousedown", (e) => {
    if ((e.target as Element).closest(".beat, .ghost-snippet, .drag-handle, button")) return; // those handle their own clicks
    selectNodeOnClick(e, view, getPos);
  });
  wireContextMenu(dom, view, getPos);

  let lastCond = " ", lastJump = " "; // force a first paint of each
  const paintCondition = (n: typeof node): void => {
    const c = (rawAttr(n) as { condition?: string }).condition ?? "";
    if (c === lastCond) return;
    lastCond = c;
    cond.textContent = c ? `if ${humanizeCondition(c)}` : "";
    dom.classList.toggle("has-cond", c.length > 0);
  };
  let jumpTo = ""; // the current divert target id (for double-click-to-follow); "" / "END" don't navigate
  const paintJump = (n: typeof node): void => {
    const raw = n.attrs.jump as string;
    if (raw === lastJump) return;
    lastJump = raw;
    dom.classList.toggle("has-jump", raw.length > 0);
    if (raw) {
      const d = JSON.parse(raw) as { to?: string; mode?: string };
      jumpTo = String(d.to ?? "");
      jump.textContent = `${d.mode === "call" ? "⤳" : "↪"} ${resolveJumpLabel(jumpTo)}`;
      jump.dataset.tip = jumpTo && jumpTo !== "END" ? "double-click to go to target" : "";
    } else { jumpTo = ""; jump.textContent = ""; jump.dataset.tip = ""; }
  };
  // Double-click the jump chip -> follow the divert to its target (the host switches scene if needed).
  jump.addEventListener("dblclick", (e) => { if (!jumpTo || jumpTo === "END") return; e.preventDefault(); e.stopPropagation(); jumpNav?.(jumpTo); });
  const paintEmpty = (n: typeof node): void => { dom.classList.toggle("is-empty", n.childCount === 0); }; // beat-less -> ghost
  paintCondition(node); paintJump(node); paintEmpty(node);
  // Re-resolve the humanized labels on a rename / target-list change (refreshJumpLabels): force BOTH the
  // jump chip AND the condition tag past their unchanged guards. The condition tag humanizes `visits(id)`
  // too, so if it was painted before the (cross-scene) targets were ready - e.g. a lazy project load - it
  // must re-resolve here or it sticks on the raw block id.
  let curNode = node;
  const refresh = (): void => { lastJump = " "; lastCond = " "; paintJump(curNode); paintCondition(curNode); };
  jumpRefreshers.add(refresh);
  return {
    dom, contentDOM, ignoreMutation: ignoreChrome(contentDOM),
    update: (n) => { if (n.type.name !== "snippet") return false; curNode = n; dom.dataset.id = idOf(n); paintCondition(n); paintJump(n); paintEmpty(n); return true; },
    destroy: () => { jumpRefreshers.delete(refresh); },
  };
};

/** Is the group at `pos` a choice OPTION (a direct child of a `choice` group)? */
function isChoiceOption(view: View, pos: number | undefined): boolean {
  if (pos == null) return false;
  return isChoiceGroup(view.state.doc.resolve(pos).parent);
}

/**
 * A group renders as a left-RAIL container (groups §3 / §13.2): the rail + a
 * header label are a persistent structural cue (always visible), the children
 * edit inline. A choice's children render as OPTION rows (◇ + the prompt cell), with
 * an "+ option" control on the choice; their condition / secret flag is edited from the
 * rail's "edit" popover (the choice text lives in the option's prompt cell, §14.8).
 */
export const groupView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement("div"); dom.className = "group-rail";
  const head = document.createElement("div"); head.className = "group-rail-head"; head.contentEditable = "false";
  const drag = makeDragHandle(view, getPos); drag.classList.add("rail-drag"); // to the LEFT of the type label
  const label = document.createElement("span"); label.className = "group-rail-label";
  const cond = document.createElement("span"); cond.className = "group-rail-cond"; // read-only condition tag (only when set)
  const dots = menuButton(view, getPos); dots.classList.add("group-menu");          // ⋯ structural menu, top-right of the rail head
  head.append(drag, label, cond, dots);
  wireContextMenu(head, view, getPos);
  // Click the rail head -> node-select the group so the inspector tracks it. Skip the drag handle + ⋯ menu
  // (each owns its gesture); a click on the read-only condition tag selects the group too (its editable
  // Condition row is in the inspector). stopPropagation is essential - else PM reasserts a caret on mouseup.
  head.addEventListener("mousedown", (e) => {
    const t = e.target as Node;
    if (drag.contains(t) || dots.contains(t)) return;
    const pos = getPos(); if (pos == null) return;
    e.preventDefault(); e.stopPropagation(); selectChunkAt(view, pos);
  });
  const body = document.createElement("div"); body.className = "group-rail-body";
  const ghost = ghostSnippet(view, getPos); // shown only when the group body is empty (CSS)
  // "+ option" lives in the SPACE after each option (centred), mirroring "+ block";
  // shown only when this group IS an option (CSS).
  const after = document.createElement("div"); after.className = "option-after"; after.contentEditable = "false";
  after.append(addOptionButton(view, getPos));
  dom.append(head, body, ghost, after);
  const paint = (n: typeof node): void => {
    dom.dataset.id = idOf(n);
    const raw = rawAttr(n);
    const option = isChoiceOption(view, getPos());
    // An option's choice text lives in its prompt CELL (the optionprompt node, §13.10), so the
    // rail label is just the marker (+ a secret flag).
    // The ◇ marker now lives on the option's PROMPT cell (CSS .option-prompt::before), not the rail
    // label - so the diamond sits with the choice text it marks.
    label.textContent = option ? `option${raw.secretUntilEligible ? "  · secret" : ""}` : groupLabel(raw);
    const c = typeof raw.condition === "string" ? raw.condition : "";
    cond.textContent = c ? `if ${humanizeCondition(c)}` : "";  // surface the condition (read-only, ids->titles); inspector edits it
    cond.style.display = c ? "" : "none";
    dom.classList.toggle("is-choice", raw.selector === "choice");
    dom.classList.toggle("is-option", option);
    // empty CONTENT run -> ghost (the prompt cell is not content, so it doesn't count)
    let chunks = 0; n.forEach((ch) => { if (ch.type.name !== "optionprompt") chunks++; });
    dom.classList.toggle("is-empty", chunks === 0);
  };
  paint(node);
  // A group's condition tag humanizes `visits(id)` too, so it must re-resolve when the target list changes
  // (refreshJumpLabels) - otherwise a block ref painted before the targets were ready sticks on its raw id.
  let curNode = node;
  const refresh = (): void => paint(curNode);
  jumpRefreshers.add(refresh);
  return {
    dom, contentDOM: body, ignoreMutation: ignoreChrome(body),
    update: (n) => { if (n.type.name !== "group") return false; curNode = n; paint(n); return true; },
    destroy: () => { jumpRefreshers.delete(refresh); },
  };
};

/** Add an option AFTER this one (groups §8) - centred in the gap below each option (CSS). */
function addOptionButton(view: View, getPos: GetPos): HTMLButtonElement {
  const b = document.createElement("button"); b.className = "group-ctl add-option"; b.textContent = "+ option"; b.dataset.tip = "add a choice option";
  b.addEventListener("mousedown", (e) => { e.preventDefault(); const pos = getPos(); if (pos == null) return; const tr = insertOptionAfter(view.state, pos); if (tr) view.dispatch(tr); view.focus(); });
  return b;
}

/** Unknown chunk the surface does not model yet - a quiet opaque card. */
export const rawnodeView: NodeViewConstructor = (node) => {
  const dom = document.createElement("div"); dom.className = "rawnode"; dom.contentEditable = "false";
  const g = JSON.parse(node.attrs.json) as { type?: string };
  dom.textContent = `⋯ ${String(g.type ?? "node")}`;
  return { dom };
};

// --- block (the document outline: H1 sections, groups §1/§3) -----------------

/** New block after this one (the outline-level create, groups §3). */
function addBlockButton(view: View, getPos: GetPos): HTMLButtonElement {
  const b = document.createElement("button"); b.className = "block-ctl add"; b.textContent = "+ block"; b.dataset.tip = "new block after this one";
  b.addEventListener("mousedown", (e) => { e.preventDefault(); const pos = getPos(); if (pos == null) return; const tr = insertBlock(view.state, pos); if (tr) view.dispatch(tr); view.focus(); });
  return b;
}

/**
 * A block renders as an H1 section: an editable name heading (the heading IS the
 * jump-target label) + its content, FLAT (no indent - groups §1). Reorder /
 * create controls are quiet; the heading is always visible structure.
 */
export const blockView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement("div"); dom.className = "block";
  const head = document.createElement("div"); head.className = "block-head"; head.contentEditable = "false";
  const drag = makeDragHandle(view, getPos); drag.classList.add("block-drag"); // to the LEFT of the title
  const name = document.createElement("input"); name.className = "block-name"; name.spellcheck = false; name.placeholder = "<section name>";
  // The quiet ⋯ control (matching snippets / groups) opens the block's note menu - Note…, status, and
  // Delete block - so the action is discoverable, not buried behind a right-click only.
  const dots = document.createElement("button"); dots.className = "menu-dots block-dots"; dots.textContent = "⋯"; dots.dataset.tip = "actions"; dots.setAttribute("aria-label", "actions"); dots.contentEditable = "false";
  dots.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); menu().open(view, getPos, dots, "note"); });
  head.append(drag, name, dots);
  wireNoteMenu(head, view, getPos); // right-click the block heading -> "Note…" (#148)
  // Click the heading -> node-select the block so the inspector tracks the block (not the last beat). Skip
  // the drag handle (it owns the gesture); the name input still selects via its focus handler below.
  const selectBlock = (): void => { const pos = getPos(); if (pos == null) return; view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); };
  head.addEventListener("mousedown", (e) => {
    const t = e.target as Node;
    if (drag.contains(t)) return;                          // the drag handle owns its own gesture
    // stopPropagation is essential: without it ProseMirror tracks the mousedown on view.dom and reasserts
    // a caret at the click on mouseup, instantly reverting the inspector to the nearest beat.
    if (name.contains(t)) { e.stopPropagation(); return; } // let the rename input focus; just keep PM out
    e.preventDefault(); e.stopPropagation(); selectBlock(); view.focus();
  });
  name.addEventListener("focus", selectBlock); // focusing the rename field also shows the block in the inspector
  const body = document.createElement("div"); body.className = "block-body";
  const ghost = ghostSnippet(view, getPos); // shown only when the block is empty (CSS)
  // "+ block" lives in the SPACE after the block (the inter-block gap), not in the header.
  const after = document.createElement("div"); after.className = "block-after"; after.contentEditable = "false";
  after.append(addBlockButton(view, getPos));
  dom.append(head, body, ghost, after);

  const sync = (n: typeof node): void => {
    dom.dataset.id = idOf(n);
    const raw = rawAttr(n) as { name?: string }; if (document.activeElement !== name) name.value = raw.name ?? "";
    dom.classList.toggle("is-empty", n.childCount === 0); // empty block -> ghost
  };
  name.addEventListener("change", () => { const pos = getPos(); if (pos == null) return; const tr = setBlockName(view.state, pos, name.value); if (tr) { view.dispatch(tr); refreshJumpLabels(); } }); // renaming a block updates every jump chip that targets it
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } });
  // The rename field is a plain <input> sitting INSIDE the contentEditable surface, so the browser's
  // native drag-and-drop treats it as a drop target: dragging across the title to select it could end up
  // DROPPING the editor's current selection (a whole block's worth of lines) into the name. Nothing here
  // inserts text on purpose - change/keydown only read it - so refuse both ends of that gesture: never
  // start a drag from the field, and never accept one into it. Selecting by dragging then behaves normally.
  name.addEventListener("dragstart", (e) => { e.preventDefault(); e.stopPropagation(); });
  name.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = "none"; });
  name.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); });
  sync(node);
  return {
    dom, contentDOM: body, ignoreMutation: ignoreChrome(body),
    // The block heading (rename input + drag handle) lives inside view.dom but is NOT editor content.
    // Focusing the title node-SELECTS the block (so the inspector tracks it), which leaves a replaceable
    // NodeSelection in PM state; without this, a keystroke in the input reaches PM's handler and REPLACES
    // the whole selected block (the bug where typing wiped the section). stopEvent is the hook PM itself
    // consults before handling any event from a node view - returning true makes it ignore everything from
    // the heading, so the input edits its own text natively and PM never touches the block.
    stopEvent: (e: Event) => head.contains(e.target as Node),
    update: (n) => { if (n.type.name !== "block") return false; sync(n); return true; },
  };
};

/** The zone-model node views, ready to pass to an EditorView. */
export const nodeViews = {
  line: lineView, prose: proseView, cue: cueView, paren: parenView, say: sayView,
  gameEvent: gameEventView, optionprompt: optionpromptView,
  snippet: snippetView, group: groupView, rawnode: rawnodeView, block: blockView,
};
