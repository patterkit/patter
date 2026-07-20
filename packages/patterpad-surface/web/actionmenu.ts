// The action menu (groups §3 / §7): ONE adaptive structural menu per snippet or group,
// reached from a quiet ⋯ control OR a right-click. It holds STRUCTURAL actions only -
// Follow with, Wrap in, Add option, Ungroup, Split, Join, Delete. Data (condition, jump,
// group behaviour, option fields) is the inspector pane's job; this menu never edits it.
//
// It is a familiar vertical MENU: items stack top to bottom; "Follow with" and "Wrap in"
// open SUBMENU flyouts (a right-hand panel of kinds) on hover / click - the conventional
// idiom, not embedded button rows. Writes through insertAfter / wrapChunk / insertOption /
// insertOptionAfter / unwrapGroup / splitSnippetHere / joinSnippet / deleteChunk.

import type { EditorView } from "prosemirror-view";
import { insertAfter, wrapChunk, wrapChunksAt, insertOption, insertOptionAfter, unwrapGroup, deleteChunk, deleteChunksAt, deleteBlock, joinSnippet, chunkIsEmpty, type GroupKind } from "../src/groups.js";
import { duplicateChunk, notifyDuplicated } from "../src/duplicate.js";
import { multiSelectPositions } from "../src/multiselect.js";
import { splitSnippetHere } from "../src/lines.js";
import { createFloating } from "./floating.js";
import { confirmDialog } from "./confirm.js";
import { isChoiceGroup, modelIdOf } from "../src/zoneutil.js";
import { notesEnabled, openNoteFor } from "./docnotes.js";
import { commentsEnabled, hasSaySelection, startComment } from "./comments.js";
import { suggestionsEnabled, startSuggestion } from "./suggestions.js";
import { writingStatusEnabled, writingStatusLadder, applyWritingStatus, collectBeatIds, writingStatusOf } from "./writingstatus.js";

type GetPos = () => number | undefined;
type At = HTMLElement | { x: number; y: number };
/** "full" = the whole structural menu; "add" = just the add-after kinds (the discreet + control);
 *  "note" = a note-only menu (for nodes without structural actions - scene / block / beat). */
type Mode = "full" | "add" | "note";
type Cmd = (state: EditorView["state"], pos: number) => ReturnType<typeof insertAfter>;

const ADD_KINDS: Array<{ label: string; kind: "snippet" | GroupKind }> = [
  { label: "Snippet", kind: "snippet" }, { label: "Branch", kind: "if" }, { label: "Choice", kind: "choice" },
  { label: "Once each", kind: "sequence" }, { label: "Cycle", kind: "cycle" }, { label: "Shuffle", kind: "shuffle" },
  { label: "Best match", kind: "bestmatch" },
];
const WRAP_KINDS: Array<{ label: string; kind: GroupKind }> = [
  { label: "Branch", kind: "if" }, { label: "Choice", kind: "choice" }, { label: "Once each", kind: "sequence" },
  { label: "Cycle", kind: "cycle" }, { label: "Shuffle", kind: "shuffle" }, { label: "Best match", kind: "bestmatch" },
];

/** When set, the menu's "Note…" targets THIS node (id + kind) rather than the node at `getPos` - lets a
 *  beat right-click run structural actions on the enclosing snippet while noting the beat itself. */
export interface NoteTarget { id: string; kind?: string }

export interface ActionMenu {
  open(view: EditorView, getPos: GetPos, at: At, mode?: Mode, note?: NoteTarget | null): void;
  close(): void;
}

// Host hook for "Play block" (opens the play window entering that block). Null = no Play-block item.
let playBlockHandler: ((blockId: string) => void) | null = null;
export function setPlayBlockHandler(fn: ((blockId: string) => void) | null): void { playBlockHandler = fn; }

/** The id of the BLOCK that encloses the node at `pos` (walking up the doc), or null. */
function enclosingBlockId(state: EditorView["state"], pos: number): string | null {
  const $p = state.doc.resolve(pos);
  for (let d = $p.depth; d >= 0; d--) {
    const n = $p.node(d);
    if (n.type.name === "block") return modelIdOf(n);
  }
  return null;
}

/** One shared structural menu, created lazily on first use. */
export function createActionMenu(): ActionMenu {
  const floating = createFloating("action-menu");
  const el = floating.el;
  const sub = document.createElement("div"); sub.className = "action-menu action-submenu"; sub.style.display = "none";
  document.body.appendChild(sub);
  let ctx: { view: EditorView; getPos: GetPos; at: At; mode: Mode; note: NoteTarget | null } | null = null;

  // A click is "inside" (does not dismiss) if it lands in the flyout or on the anchor that opened us.
  const insideMenu = (t: Node): boolean => sub.contains(t) || (ctx?.at instanceof HTMLElement && ctx.at === t);
  function close(): void {
    closeSub(); ctx = null; floating.close();
  }
  function closeSub(): void { sub.style.display = "none"; sub.replaceChildren(); el.querySelector(".action-mi.open")?.classList.remove("open"); }

  const place = (): void => {
    if (!ctx) return;
    let left: number, top: number;
    if (ctx.at instanceof HTMLElement) { const r = ctx.at.getBoundingClientRect(); left = r.right - 8; top = r.bottom + 4; }
    else { left = ctx.at.x; top = ctx.at.y; }
    const w = el.offsetWidth || 200, h = el.offsetHeight || 240;
    el.style.left = `${Math.round(Math.max(8, Math.min(left, window.innerWidth - w - 8)))}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(top, window.innerHeight - h - 8)))}px`;
    closeSub(); // a reposition (scroll) dismisses any open flyout - it would otherwise float away
  };

  /** Run a structural command, then refocus the surface and dismiss the menu. */
  const act = (cmd: Cmd): void => {
    if (!ctx) return; const pos = ctx.getPos(); if (pos == null) return;
    const tr = cmd(ctx.view.state, pos); if (tr) ctx.view.dispatch(tr);
    ctx.view.focus(); close();
  };

  /** Duplicate the chunk (with its children) as the next sibling. Every copied node gets a fresh id, and
   *  the host is handed the old -> new map so it can carry the sidecar metadata (status, notes) across. */
  const duplicateCmd: Cmd = (s, p) => {
    const res = duplicateChunk(s, p);
    if (!res) return null;
    notifyDuplicated(res.idMap);
    return res.tr;
  };

  /** A leaf menu item: label + a click that runs `cmd`. */
  const leaf = (label: string, cls: string, cmd: Cmd): HTMLElement => {
    const mi = document.createElement("button"); mi.className = `action-mi ${cls}`; mi.textContent = label;
    mi.addEventListener("mouseenter", closeSub);              // leaving a submenu parent closes the flyout
    mi.addEventListener("mousedown", (e) => { e.preventDefault(); act(cmd); });
    return mi;
  };

  /** The "Note…" item: open / add a documentation note on the node at the cursor (a host action - the
   *  editor lives in the renderer). Anchors to the node's DOM, resolved after the menu closes. */
  const noteItem = (): HTMLElement => {
    const mi = document.createElement("button"); mi.className = "action-mi"; mi.textContent = "Note…";
    mi.addEventListener("mouseenter", closeSub);
    mi.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!ctx) return; const view = ctx.view;
      // An explicit note target (a beat right-click) wins; otherwise note the node at the menu position.
      const note = ctx.note;
      if (note) { close(); openNoteFor(note.id, view.dom, note.kind); return; }
      const p = ctx.getPos(); const n = p == null ? null : view.state.doc.nodeAt(p); const id = n ? modelIdOf(n) : null;
      close();
      if (p != null && id) { const dom = view.nodeDOM(p); openNoteFor(id, dom instanceof HTMLElement ? dom : view.dom, n?.type.name); }
    });
    return mi;
  };

  /** The note-target beat (a say/prose beat) when the menu is beat-aware, else null - used to decide
   *  whether a whole-beat comment is offerable. */
  const commentBeat = (): { id: string; kind?: string } | null =>
    ctx?.note && (ctx.note.kind === "line" || ctx.note.kind === "prose") ? ctx.note : null;
  /** Whether "Add comment" applies here: comments are wired AND there's either a say-text selection (a
   *  range comment) or a say/prose beat target (a whole-beat comment). */
  const canComment = (): boolean => !!ctx && commentsEnabled() && (hasSaySelection(ctx.view.state) || commentBeat() !== null);

  /** The "Add comment" item: a range thread on the current say-text selection, else a whole-beat thread
   *  on the targeted beat (replaces the old floating affordance). */
  const commentItem = (): HTMLElement => {
    const mi = document.createElement("button"); mi.className = "action-mi"; mi.textContent = "Add comment…";
    mi.addEventListener("mouseenter", closeSub);
    mi.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!ctx) return; const view = ctx.view; const beatId = commentBeat()?.id ?? null;
      close();
      startComment(view, beatId, view.dom);
    });
    return mi;
  };

  /** Whether "Suggest rewrite" applies: suggestions are wired AND the target is a say / prose beat
   *  (whole-beat proposals only - no rewriting a container or an action atom). */
  const canSuggest = (): boolean => suggestionsEnabled() && commentBeat() !== null;
  /** The "Suggest rewrite…" item: start a rewrite proposal on the targeted beat (host opens a prefilled
   *  modal). */
  const suggestItem = (): HTMLElement => {
    const mi = document.createElement("button"); mi.className = "action-mi"; mi.textContent = "Suggest rewrite…";
    mi.addEventListener("mouseenter", closeSub);
    mi.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!ctx) return; const view = ctx.view; const beatId = commentBeat()?.id; if (!beatId) return;
      close();
      startSuggestion(view, beatId, view.dom);
    });
    return mi;
  };

  /** A submenu parent: hovering / clicking opens a right-hand flyout of `kinds`. */
  const parent = (label: string, kinds: Array<{ label: string; cmd: Cmd }>): HTMLElement => {
    const mi = document.createElement("button"); mi.className = "action-mi has-sub"; mi.textContent = label;
    const caret = document.createElement("span"); caret.className = "action-caret"; caret.textContent = "›"; mi.appendChild(caret);
    const openThis = (): void => openSub(mi, kinds);
    mi.addEventListener("mouseenter", openThis);
    mi.addEventListener("mousedown", (e) => { e.preventDefault(); openThis(); });
    return mi;
  };

  /** Populate + position the flyout next to its parent item. */
  const openSub = (anchor: HTMLElement, kinds: Array<{ label: string; cmd: Cmd }>): void => {
    el.querySelectorAll(".action-mi.open").forEach((n) => n.classList.remove("open"));
    anchor.classList.add("open");
    sub.replaceChildren();
    for (const k of kinds) {
      const mi = document.createElement("button"); mi.className = "action-mi"; mi.textContent = k.label;
      mi.addEventListener("mousedown", (e) => { e.preventDefault(); act(k.cmd); });
      sub.appendChild(mi);
    }
    sub.style.display = "block";
    const r = anchor.getBoundingClientRect();
    const w = sub.offsetWidth || 150, h = sub.offsetHeight || 180;
    let left = r.right - 4; if (left + w > window.innerWidth - 8) left = r.left - w + 4; // flip left if no room
    const top = Math.min(r.top - 4, window.innerHeight - h - 8);
    sub.style.left = `${Math.round(Math.max(8, left))}px`;
    sub.style.top = `${Math.round(Math.max(8, top))}px`;
  };

  // --- writing status (#196) -------------------------------------------------
  // The "Status" submenu sets a HOST value (AuthoringFile.writing), not a doc command, so it needs a
  // run-callback flyout rather than the structural `Cmd` one. Items carry the rung's palette swatch.
  type RunItem = { label: string; slot?: number; checked?: boolean; run: () => void };

  const parentRun = (label: string, items: RunItem[]): HTMLElement => {
    const mi = document.createElement("button"); mi.className = "action-mi has-sub"; mi.textContent = label;
    const caret = document.createElement("span"); caret.className = "action-caret"; caret.textContent = "›"; mi.appendChild(caret);
    const openThis = (): void => openSubRun(mi, items);
    mi.addEventListener("mouseenter", openThis);
    mi.addEventListener("mousedown", (e) => { e.preventDefault(); openThis(); });
    return mi;
  };

  const openSubRun = (anchor: HTMLElement, items: RunItem[]): void => {
    el.querySelectorAll(".action-mi.open").forEach((n) => n.classList.remove("open"));
    anchor.classList.add("open");
    sub.replaceChildren();
    for (const it of items) {
      const mi = document.createElement("button"); mi.className = "action-mi action-run";
      // A leading tick column (a ✓ on the current rung, empty otherwise) so the swatches stay aligned.
      const check = document.createElement("span"); check.className = "action-check"; check.textContent = it.checked ? "✓" : ""; mi.appendChild(check);
      if (it.slot != null) { const dot = document.createElement("span"); dot.className = "status-swatch"; dot.style.background = `var(--char-${it.slot})`; mi.appendChild(dot); }
      mi.appendChild(document.createTextNode(it.label));
      // Run BEFORE close (the target ids resolve against the live ctx), then refocus + dismiss.
      mi.addEventListener("mousedown", (e) => { e.preventDefault(); it.run(); ctx?.view.focus(); close(); });
      sub.appendChild(mi);
    }
    sub.style.display = "block";
    const r = anchor.getBoundingClientRect();
    const w = sub.offsetWidth || 150, h = sub.offsetHeight || 180;
    let left = r.right - 4; if (left + w > window.innerWidth - 8) left = r.left - w + 4;
    const top = Math.min(r.top - 4, window.innerHeight - h - 8);
    sub.style.left = `${Math.round(Math.max(8, left))}px`;
    sub.style.top = `${Math.round(Math.max(8, top))}px`;
  };

  /** The "Status ▸" items: each ladder rung (with its colour swatch). No "clear" - unset == the lowest
   *  rung, so clearing is meaningless. `current` ticks the target beat's rung (single-beat target only).
   *  `ids` is lazy so it resolves against the live menu context at click time. */
  const statusItems = (ids: () => string[], current?: string): RunItem[] =>
    writingStatusLadder().map((r) => ({ label: r.name, slot: r.colour, checked: r.name === current, run: () => applyWritingStatus(ids(), r.name) }));
  /** Append the Status submenu (when wired), targeting the beats `ids()` resolves to. When the target is a
   *  SINGLE beat, tick its current (effective) rung - an unset beat reads as the lowest rung. */
  const appendStatus = (host: HTMLElement, ids: () => string[]): void => {
    if (!writingStatusEnabled()) return;
    const targets = ids();
    const current = targets.length === 1 && ctx
      ? (writingStatusOf(ctx.view, targets[0]!) ?? writingStatusLadder()[0]?.name)
      : undefined;
    host.appendChild(parentRun("Status", statusItems(ids, current)));
  };
  /** The beats a Status set should hit from the current single-node context: a targeted line/prose BEAT,
   *  else every line/prose beat under the node (snippet / group / block), or the whole doc for a scene. */
  const statusTargets = (): string[] => {
    if (!ctx) return [];
    const k = ctx.note?.kind;
    if ((k === "line" || k === "prose") && ctx.note) return [ctx.note.id];
    if (k === "scene") return collectBeatIds(ctx.view.state.doc);
    const p = ctx.getPos(); const n = p == null ? null : ctx.view.state.doc.nodeAt(p);
    return n ? collectBeatIds(n) : [];
  };

  const render = (): void => {
    if (!ctx) return;

    // Note-only menu (scene / block heading - nodes with no structural actions): "Note…" (+ comment /
    // suggestion when offerable) + the writing-status submenu. Resolved BEFORE the structural pos/node
    // guards so a SCENE (which has no node position - it's the doc itself) is handled too.
    if (ctx.mode === "note") {
      el.replaceChildren();
      el.appendChild(headEl(ctx.note?.kind === "scene" ? "Scene" : "Note"));
      el.appendChild(noteItem());
      if (canComment()) el.appendChild(commentItem());
      if (canSuggest()) el.appendChild(suggestItem());
      appendStatus(el, statusTargets);
      // A BLOCK heading's note menu also carries Delete (the only place a whole block can be removed).
      // Refused when it is the scene's last block - the doc must keep at least one - so it is hidden then.
      const bPos = ctx.getPos();
      const bNode = bPos != null ? ctx.view.state.doc.nodeAt(bPos) : null;
      if (bNode?.type.name === "block") {
        // Duplicate the whole block + everything in it. Always available (unlike Delete, which is
        // refused on the last block): the copy is named "<name> copy" and takes fresh ids throughout.
        el.appendChild(sepEl());
        el.appendChild(leaf("Duplicate", "", duplicateCmd));
      }
      if (bNode?.type.name === "block" && ctx.view.state.doc.childCount > 1) {
        const del = document.createElement("button"); del.className = "action-mi del"; del.textContent = "Delete block";
        del.addEventListener("mouseenter", closeSub);
        del.addEventListener("mousedown", (e) => {
          e.preventDefault();
          if (!ctx) return; const view = ctx.view; const at = ctx.getPos(); close();
          if (at == null) return;
          let name = "this block";
          try { name = (JSON.parse(view.state.doc.nodeAt(at)?.attrs.raw as string)?.name as string) || name; } catch { /* keep default */ }
          confirmDialog({ title: `Delete "${name}"?`, body: "The block and everything inside it will be removed. You can undo it.", confirmLabel: "Delete" })
            .then((ok) => { if (ok) { const tr = deleteBlock(view.state, at); if (tr) view.dispatch(tr); view.focus(); } });
        });
        el.appendChild(del);
      }
      floating.show(place); return;
    }

    const pos = ctx.getPos(); if (pos == null) return close();
    const node = ctx.view.state.doc.nodeAt(pos); if (!node) return close();

    // Right-clicking a chunk that is part of the multi-select set (groups §6) acts on the whole set:
    // wrap them all, or delete them all. (This is the only place wrap is offered for a multi-selection -
    // there is no auto-popup; the author reaches for it deliberately.)
    const setPositions = ctx.mode === "full" ? multiSelectPositions(ctx.view.state) : [];
    if (setPositions.length >= 2 && setPositions.includes(pos)) {
      const n = setPositions.length;
      el.replaceChildren();
      el.appendChild(headEl(`${n} selected`));
      el.appendChild(parent("Wrap in", WRAP_KINDS.map((k) => ({ label: k.label, cmd: ((s) => wrapChunksAt(s, multiSelectPositions(s), k.kind)) as Cmd }))));
      // Status ripples across the whole selection: every line / prose beat under each selected chunk.
      appendStatus(el, () => setPositions.flatMap((p) => { const sn = ctx?.view.state.doc.nodeAt(p); return sn ? collectBeatIds(sn) : []; }));
      el.appendChild(sepEl());
      const del = document.createElement("button"); del.className = "action-mi del"; del.textContent = "Delete";
      del.addEventListener("mouseenter", closeSub);
      del.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (!ctx) return; const view = ctx.view; close();
        confirmDialog({ title: `Delete these ${n} items?`, body: `${n} items and everything inside them will be removed. You can undo it.`, confirmLabel: "Delete" })
          .then((ok) => { if (ok) { const tr = deleteChunksAt(view.state, multiSelectPositions(view.state)); if (tr) view.dispatch(tr); view.focus(); } });
      });
      el.appendChild(del);
      floating.show(place); return;
    }

    const isGroup = node.type.name === "group";
    const isOption = isGroup && isChoiceGroup(ctx.view.state.doc.resolve(pos).parent);
    const isChoice = isChoiceGroup(node);
    el.replaceChildren();

    // The discreet "+" add control: a flat list of the add-after kinds, nothing structural.
    if (ctx.mode === "add") {
      el.appendChild(headEl("Follow with"));
      for (const k of ADD_KINDS) el.appendChild(leaf(k.label, "", (s, p) => insertAfter(s, p, k.kind)));
      floating.show(place); return;
    }

    el.appendChild(headEl(isOption ? "Option" : isChoice ? "Choice" : isGroup ? "Group" : "Snippet"));

    if (isOption) {
      el.appendChild(leaf("Add option", "", (s, p) => insertOptionAfter(s, p)));
    } else {
      el.appendChild(parent("Follow with", ADD_KINDS.map((k) => ({ label: k.label, cmd: ((s, p) => insertAfter(s, p, k.kind)) as Cmd }))));
      el.appendChild(parent("Wrap in", WRAP_KINDS.map((k) => ({ label: k.label, cmd: ((s, p) => wrapChunk(s, p, k.kind)) as Cmd }))));
      if (isChoice) el.appendChild(leaf("Add option", "", (s, p) => insertOption(s, p)));
      if (isGroup) el.appendChild(leaf("Ungroup", "", (s, p) => unwrapGroup(s, p)));
      if (!isGroup) { // split / join are snippet-only, and only when applicable
        if (splitSnippetHere(ctx.view.state, pos)) el.appendChild(leaf("Split here", "", (s, p) => splitSnippetHere(s, p)));
        if (joinSnippet(ctx.view.state, pos, "up")) el.appendChild(leaf("Join with previous", "", (s, p) => joinSnippet(s, p, "up")));
        if (joinSnippet(ctx.view.state, pos, "down")) el.appendChild(leaf("Join with next", "", (s, p) => joinSnippet(s, p, "down")));
      }
    }

    // Duplicate: the chunk AND everything inside it, dropped in as the next sibling with fresh ids
    // throughout (an option duplicates too - a quick way to add a variant of a choice).
    el.appendChild(leaf("Duplicate", "", duplicateCmd));

    // Play Block: start an interactive run ENTERING this node's block (not the whole scene). A host
    // action (opens the play window), not a doc edit - gated on the host wiring a handler.
    const blockId = enclosingBlockId(ctx.view.state, pos);
    if (playBlockHandler && blockId) {
      el.appendChild(sepEl());
      const pb = document.createElement("button"); pb.className = "action-mi"; pb.textContent = "▶ Play block";
      pb.addEventListener("mouseenter", closeSub);
      pb.addEventListener("mousedown", (e) => { e.preventDefault(); const id = blockId; close(); playBlockHandler?.(id); });
      el.appendChild(pb);
    }

    // Documentation note + collaboration comment + rewrite suggestion + writing status on this chunk /
    // beat. Status targets the beat when a beat is right-clicked, else ripples the snippet / group's beats.
    if (notesEnabled() || canComment() || canSuggest() || writingStatusEnabled()) {
      el.appendChild(sepEl());
      if (notesEnabled()) el.appendChild(noteItem());
      if (canComment()) el.appendChild(commentItem());
      if (canSuggest()) el.appendChild(suggestItem());
      appendStatus(el, statusTargets);
    }

    el.appendChild(sepEl());
    const noun = isOption ? "option" : isGroup ? "group" : "snippet";
    const del = document.createElement("button"); del.className = "action-mi del"; del.textContent = "Delete";
    del.addEventListener("mouseenter", closeSub);
    del.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!ctx) return; const view = ctx.view, getPos = ctx.getPos; close();
      const remove = (): void => { const p = getPos(); if (p == null) return; const tr = deleteChunk(view.state, p); if (tr) view.dispatch(tr); view.focus(); };
      // No confirmation when nothing is lost - an empty bubble, or a group of only empty bubbles.
      if (chunkIsEmpty(node)) { remove(); return; }
      confirmDialog({ title: `Delete this ${noun}?`, body: `The ${noun} and everything inside it will be removed. You can undo it.`, confirmLabel: "Delete" })
        .then((ok) => { if (ok) remove(); });
    });
    el.appendChild(del);

    floating.show(place);
  };

  const headEl = (text: string): HTMLElement => { const h = document.createElement("div"); h.className = "action-head"; h.textContent = text; return h; };
  const sepEl = (): HTMLElement => { const s = document.createElement("div"); s.className = "action-sep"; return s; };

  const open = (view: EditorView, getPos: GetPos, at: At, mode: Mode = "full", note: NoteTarget | null = null): void => {
    ctx = { view, getPos, at, mode, note };
    render(); // builds the menu, then floating.show(place) positions + follows on scroll
    window.setTimeout(() => floating.dismissOnOutside(close, insideMenu), 0); // arm click-away after the opening click
  };
  return { open, close };
}
