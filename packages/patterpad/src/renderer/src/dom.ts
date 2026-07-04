// Shared DOM helpers for the renderer. Two jobs:
//   - `el`: the tiny tag-typed element factory (was copy-pasted as `mk` / `el` in six files).
//   - `openAnchoredPanel` + `placeLeftOfAnchor`: the body-level floating-panel lifecycle the inspector's
//     editors (condition / effects / jump / gameId) all share - a titled header with a ✕, left-of-anchor
//     placement, and the capture-phase outside-click / Escape close. Previously each editor re-implemented
//     this, with the left-placement offset diverging per file (literal 230/250 vs the panel width).

import { closeWithExit } from "@patterkit/patterpad-surface/exit";

/** Create an element with an optional class and text. Tag-typed return, so no casts at call sites. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** A small square glyph button (the gd-icon move/delete controls the settings editors share). */
export function iconBtn(glyph: string, title: string, onClick: () => void, disabled = false, danger = false): HTMLButtonElement {
  const b = el("button", `gd-icon${danger ? " danger" : ""}`);
  b.type = "button"; b.textContent = glyph; b.dataset.tip = title; b.setAttribute("aria-label", title);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

/** A captioned field row: `<label class="gd-labelled"><span class="gd-fieldcap">…</span>control</label>`. */
export function labelled(label: string, control: HTMLElement): HTMLElement {
  const w = el("label", "gd-labelled");
  w.append(el("span", "gd-fieldcap", label), control);
  return w;
}

/** Swap item `i` with its neighbour `i + delta` IN PLACE (the up/down reorder the settings lists share);
 *  a no-op when the target is out of range. Returns whether anything moved. */
export function moveItem<T>(arr: T[], i: number, delta: number): boolean {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  return true;
}

/** A tag-style editor for a string-list field (an enum's allowed values / flags): removable chips + an
 *  add input (Enter or "," commits, blank/duplicate ignored). Mutates `holder.values` in place (read back
 *  on save). `onChange` fires after any add / remove - callers use it to refresh a dependent control (the
 *  enum default picker, which lists these values). Shared by the game-data and property editors. */
export function tagChips(holder: { values?: string[] }, onChange?: () => void): HTMLElement {
  const wrap = el("div", "gd-tags");
  // One PERSISTENT input (never rebuilt), so focus stays in the field after each commit - you can type a
  // run of values without clicking back in. Chips are inserted before the input as they're committed.
  const input = el("input", "gd-tag-input") as HTMLInputElement;
  input.type = "text"; input.placeholder = "<add value>"; input.spellcheck = false;
  const makeChip = (v: string): HTMLElement => {
    const chip = el("span", "gd-tag", v);
    const x = el("button", "gd-tag-x", "✕"); x.type = "button"; x.dataset.tip = `remove ${v}`; x.setAttribute("aria-label", `remove ${v}`);
    x.addEventListener("click", () => { holder.values = (holder.values ?? []).filter((o) => o !== v); chip.remove(); onChange?.(); });
    chip.append(x);
    return chip;
  };
  const commit = (): void => {
    const v = input.value.trim();
    if (v && !(holder.values ?? []).includes(v)) { (holder.values ??= []).push(v); wrap.insertBefore(makeChip(v), input); onChange?.(); }
    input.value = "";
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } });
  input.addEventListener("blur", commit);
  for (const v of holder.values ?? []) wrap.append(makeChip(v));
  wrap.append(input);
  return wrap;
}

/** Place `panel` to the LEFT of `anchor` (an inspector row) when it fits with an 8px margin, else fall
 *  back to the anchor's left edge; top just under the anchor, clamped into the viewport. */
export function placeLeftOfAnchor(panel: HTMLElement, anchor: HTMLElement, width: number): void {
  const a = anchor.getBoundingClientRect();
  const GAP = 10;
  panel.style.width = `${width}px`;
  const ideal = a.left - width - GAP;
  panel.style.left = `${Math.round(ideal >= 8 ? ideal : Math.max(8, a.left))}px`;
  // Stay CLEAR of the bottom bars (problems / review) so they remain usable, and place the panel on the
  // side of the anchor with MORE room: below it normally, but flipped ABOVE (growing up) when the anchor
  // sits low - otherwise it lands cramped against the bar with empty space above. Its body scrolls if the
  // content is taller than the room left.
  const cap = window.innerHeight * 0.7, MIN_H = 140;
  let bottomLimit = window.innerHeight - 8;
  for (const id of ["reviewbar", "problembar"]) {
    const bar = document.getElementById(id);
    if (bar) { const r = bar.getBoundingClientRect(); if (r.height > 0) bottomLimit = Math.min(bottomLimit, r.top - 6); }
  }
  const roomBelow = bottomLimit - (a.bottom + GAP);
  const roomAbove = (a.top - GAP) - 8;
  if (roomAbove > roomBelow) {
    panel.style.top = "auto"; // anchor the BOTTOM just above the element, grow upward
    panel.style.bottom = `${Math.round(window.innerHeight - (a.top - GAP))}px`;
    panel.style.maxHeight = `${Math.round(Math.max(MIN_H, Math.min(cap, roomAbove)))}px`;
  } else {
    panel.style.bottom = "auto";
    panel.style.top = `${Math.round(Math.max(8, a.bottom + GAP))}px`;
    panel.style.maxHeight = `${Math.round(Math.max(MIN_H, Math.min(cap, roomBelow)))}px`;
  }
}

export interface AnchoredPanel {
  panel: HTMLElement;
  /** The content area to populate (header is built for you). */
  body: HTMLElement;
  /** Tear down the panel + its listeners (idempotent); fires the caller's `onClose` once. */
  close: () => void;
}

/** The single anchored editor on screen (condition / effects / jump / gameId all share this lifecycle).
 *  Only one is ever open at a time, so a re-click can TOGGLE it and a different row can SWAP it. */
let current: { anchor: HTMLElement; panel: HTMLElement; close: () => void } | null = null;

/** Open a body-level floating panel anchored to an inspector row: titled header + ✕, a body, left-of-anchor
 *  placement, and the outside-click / Escape close lifecycle (capture phase, attached next tick).
 *
 *  Toggling: clicking the SAME anchor that opened the current panel closes it and returns `null` (so the
 *  trigger reads as a toggle, not the old close-then-reopen flicker); clicking a DIFFERENT anchor closes
 *  the open one and opens the new. Callers must early-return on a `null` result. */
export function openAnchoredPanel(opts: {
  anchor: HTMLElement;
  /** Panel class(es), e.g. "cond-editor jump-picker". */
  className: string;
  title: string;
  width: number;
  /** Selectors whose pointerdown must NOT close the panel (besides the panel + its anchor) - body-level
   *  inner popovers and the inspector's text-mode toggle, which the open editor reacts to in place. */
  ignoreDown?: string;
  /** When an element matching this selector exists, leave Escape for it (an open inner popover) instead
   *  of closing the panel. */
  deferEscape?: string;
  /** Teardown (e.g. destroy mounted editor handles); called exactly once when the panel closes. */
  onClose?: () => void;
}): AnchoredPanel | null {
  // Close whatever is open first. If it was anchored to the SAME row, this click is a toggle-OFF:
  // stay closed (return null) rather than re-opening (the close-then-reopen flicker). A different
  // row swaps editors. Cleared before close() so the closing panel's hook doesn't fight us.
  if (current) {
    const prev = current; current = null; prev.close();
    if (prev.anchor === opts.anchor) return null;
  }

  const panel = el("div", opts.className);
  const head = el("div", "cond-editor-head");
  head.append(el("span", "cond-editor-title", opts.title));
  const closeBtn = el("button", "cond-editor-close", "✕"); closeBtn.type = "button";
  head.append(closeBtn);
  const body = el("div", "cond-editor-body");
  panel.append(head, body);
  document.body.append(panel);
  placeLeftOfAnchor(panel, opts.anchor, opts.width);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (current && current.panel === panel) current = null;
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    // Play the exit, THEN tear down (onClose unmounts the editor, so it must run after the fade or the
    // panel would fade out empty). onClose is written to be instance-safe if another panel opened meanwhile.
    closeWithExit(panel, () => { opts.onClose?.(); panel.remove(); });
  };
  closeBtn.addEventListener("click", close);

  const onDown = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (panel.contains(t) || opts.anchor.contains(t)) return;
    if (opts.ignoreDown && t instanceof Element && t.closest(opts.ignoreDown)) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (opts.deferEscape && document.querySelector(opts.deferEscape)) return; // let the inner popover take it
    close();
  };
  // Next tick, so the click that opened the panel doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);

  current = { anchor: opts.anchor, panel, close };
  return { panel, body, close };
}
