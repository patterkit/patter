// The jump-target picker - ONE type-and-filter-and-confirm popup, shared by `/jump` (anchored to
// the caret) and the inspector / problems "Jump" affordances (anchored to a chrome element), so the
// two read identically. It is HIERARCHICAL: END, then every scene (a selectable heading - jumping to
// a scene enters its start) with its blocks indented beneath. A focusable search field filters scenes
// + blocks live; arrows move the highlight, Enter confirms, Esc / click-away dismiss. Body-appended so
// it survives editor / inspector re-renders.

import type { EditorView } from "prosemirror-view";
import { anchorBelowCaret } from "./anchor.js";
import { closeWithExit } from "./exit.js";

export interface JumpSceneGroup { scene: { id: string; label: string }; blocks: Array<{ id: string; label: string }>; }
export interface JumpData { scenes: JumpSceneGroup[]; }

/** Anchor the picker to a chrome ELEMENT (inspector row / fix button), or below the editor CARET (the
 *  `/jump` case) - the caret path uses anchorBelowCaret, which falls back off an empty zone's 0,0. */
type Anchor = HTMLElement | { caretOf: EditorView };
type Row =
  | { kind: "end" }
  | { kind: "scene"; id: string; label: string }
  | { kind: "block"; id: string; label: string; scene: string }
  | { kind: "clear" };

let active: { panel: HTMLElement; onDown: (e: PointerEvent) => void; anchor: HTMLElement | null } | null = null;

export function closeTargetPicker(): void {
  if (!active) return;
  const { panel, onDown } = active;
  active = null;
  document.removeEventListener("pointerdown", onDown, true);
  closeWithExit(panel, () => panel.remove());
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n;
};

export function openTargetPicker(opts: {
  anchor: Anchor;
  data: JumpData;
  /** Current target id ("" = none) - pre-highlighted + marked. */
  current: string;
  /** Show a "Clear jump" row (when editing an existing jump). */
  allowClear: boolean;
  /** Offer the END sentinel row (default true). False for node references (seen/visits), where END
   *  is not a real node - only scenes + blocks are valid. */
  allowEnd?: boolean;
  onPick: (target: string | null) => void;
  /** Called after the picker closes for any reason (pick / Esc / click-away) - e.g. refocus the editor. */
  afterClose?: () => void;
}): void {
  // Toggle: re-clicking the SAME chrome anchor that opened the picker closes it (and stays closed),
  // instead of the close-then-reopen flicker. The `/jump` caret case has no element anchor, so it
  // always opens fresh.
  const anchorEl = opts.anchor instanceof HTMLElement ? opts.anchor : null;
  if (active && anchorEl && active.anchor === anchorEl) { closeTargetPicker(); return; }
  closeTargetPicker();
  const panel = mk("div", "target-picker");
  const field = mk("input", "tp-field") as HTMLInputElement;
  field.type = "text"; field.placeholder = "Jump to… (type to filter)"; field.spellcheck = false;
  const list = mk("div", "tp-list");
  panel.append(field, list);
  document.body.append(panel);

  let query = "";
  let highlight = 0;
  let rows: Row[] = [];

  const computeRows = (): void => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    if (opts.allowEnd !== false && (!q || "end".includes(q))) out.push({ kind: "end" });
    for (const g of opts.data.scenes) {
      const sceneMatch = !q || g.scene.label.toLowerCase().includes(q);
      const blocks = g.blocks.filter((b) => sceneMatch || b.label.toLowerCase().includes(q));
      if (sceneMatch || blocks.length) {
        out.push({ kind: "scene", id: g.scene.id, label: g.scene.label });
        for (const b of blocks) out.push({ kind: "block", id: b.id, label: b.label, scene: g.scene.label });
      }
    }
    if (opts.allowClear) out.push({ kind: "clear" });
    rows = out;
    highlight = Math.max(0, Math.min(highlight, rows.length - 1));
  };

  const idOf = (r: Row): string | null => (r.kind === "scene" || r.kind === "block" ? r.id : r.kind === "end" ? "END" : null);
  const pick = (i: number): void => {
    const r = rows[i]; if (!r) return;
    opts.onPick(idOf(r)); // a "clear" row yields null
    close();
  };
  const close = (): void => { closeTargetPicker(); opts.afterClose?.(); };

  const render = (): void => {
    list.replaceChildren();
    rows.forEach((r, i) => {
      const sel = idOf(r) !== null && idOf(r) === opts.current;
      const cls = r.kind === "scene" ? "tp-row tp-scene" : r.kind === "block" ? "tp-row tp-block" : r.kind === "clear" ? "tp-row tp-clear" : "tp-row tp-end";
      const b = mk("button", `${cls}${i === highlight ? " active" : ""}${sel ? " sel" : ""}`);
      b.type = "button";
      b.textContent = r.kind === "end" ? "END" : r.kind === "clear" ? "Clear jump" : r.label;
      b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      b.addEventListener("mousemove", () => { if (highlight !== i) { highlight = i; render(); } });
      list.append(b);
    });
  };

  field.addEventListener("input", () => { query = field.value; highlight = 0; computeRows(); render(); });
  field.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (rows.length) { highlight = (highlight + 1) % rows.length; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (rows.length) { highlight = (highlight - 1 + rows.length) % rows.length; render(); } }
    else if (e.key === "Enter") { e.preventDefault(); pick(highlight); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  // initial fill, pre-highlighting the current target if present
  computeRows();
  const cur = rows.findIndex((r) => idOf(r) === opts.current && opts.current);
  if (cur >= 0) highlight = cur;
  render();

  // position: below the caret (the `/jump` case, via the empty-zone-safe helper), or below+left of
  // the anchor element (inspector / fix button), clamped to the viewport.
  const w = 240, h = panel.offsetHeight || 280;
  panel.style.width = `${w}px`;
  if (opts.anchor instanceof HTMLElement) {
    const r = opts.anchor.getBoundingClientRect();
    panel.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
    panel.style.top = `${Math.round(Math.min(r.bottom + 6, window.innerHeight - h - 8))}px`;
  } else {
    anchorBelowCaret(opts.anchor.caretOf, panel); // sets left/top, robust to an empty zone's 0,0 coords
  }
  field.focus();

  const onDown = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (panel.contains(t) || (opts.anchor instanceof HTMLElement && opts.anchor.contains(t))) return;
    close();
  };
  setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
  active = { panel, onDown, anchor: anchorEl };
}
