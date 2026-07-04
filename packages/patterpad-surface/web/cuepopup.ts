// The cast popup - a "field with dropdown" for the character token. The cue is no
// longer typeable text: the speaker is a UNIT you pick, replace, or add. Whenever
// the cursor is in a cue, this popup owns a search buffer; typing FILTERS the cast
// (it never edits the committed name), the list narrows, and an "Add" row appears
// for a name not yet in the cast. Picking is the only thing that changes the cue,
// and it advances to content. Adding a new character is the one place a name is
// typed - and it is registered in the project cast. Wired via EditorView props.

import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { context, type ZoneState } from "../src/context.js";
import { acceptCue, acceptCueForBeat, cueSuggestions } from "../src/cuezone.js";
import { sayStartOf } from "../src/zoneutil.js";
import { anchorBelowCaret } from "./anchor.js";
import { createFloating } from "./floating.js";

export interface CuePopup {
  update(view: EditorView, ctx?: ZoneState): void;
  handleKeyDown(view: EditorView, event: KeyboardEvent): boolean;
  isOpen(): boolean;
  close(): void;
}

type Row = { kind: "pick"; name: string } | { kind: "add"; name: string };

/**
 * @param getCast    recency-ordered project cast (the shell owns ordering).
 * @param addToCast  register a brand-new character in the project cast (rare).
 */
export function createCuePopup(getCast: () => readonly string[], addToCast: (name: string) => void = () => {}): CuePopup {
  const floating = createFloating("cue-ac");
  const el = floating.el;

  let open = false;
  let query = "";              // the search buffer - lives HERE, never in the document
  let highlight = 0;
  let activeBeat: string | null = null; // the cue being edited (a new cue resets the buffer)
  let rows: Row[] = [];
  let viewRef: EditorView | null = null;

  const close = (): void => { open = false; query = ""; activeBeat = null; floating.close(); };

  // The cue is a TOKEN: while the popup is open the whole name is SELECTED (highlighted). On a
  // deliberate dismiss (Escape / click-away) that highlight must clear - collapse the caret OFF
  // the cue to the say-content start (a NON-cue spot, so normalizeCueSelection won't re-grab it).
  // Only for explicit dismiss: the arrow / Space / Backspace closes let the spine move the caret.
  const clearCueHighlight = (view: EditorView): void => {
    if (!view.hasFocus()) return;
    const c = context(view.state);
    if (c.zone?.role !== "cue" || !c.beat?.id) return;
    const sayStart = sayStartOf(view.state.doc, c.beat.id);
    if (sayStart >= 0) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sayStart)));
  };
  const dismiss = (view: EditorView): void => { close(); clearCueHighlight(view); };

  const computeRows = (): void => {
    const cast = getCast();
    const picks: Row[] = cueSuggestions(query, cast).map((name) => ({ kind: "pick", name }));
    const q = query.trim();
    const exact = cast.some((c) => c.toLowerCase() === q.toLowerCase());
    // A new character is stored in CAPITALS (the house style for cue tokens), so the Add row shows the
    // upper-cased name the author will actually get - whatever case they typed.
    rows = q.length > 0 && !exact ? [...picks, { kind: "add", name: q.toUpperCase() }] : picks;
    highlight = Math.max(0, Math.min(highlight, rows.length - 1));
  };

  const render = (view: EditorView): void => {
    el.replaceChildren();
    const field = document.createElement("div"); field.className = "cue-ac-field";
    field.textContent = query.length ? query : "Type to filter or add a character";
    field.classList.toggle("placeholder", query.length === 0);
    el.appendChild(field);
    rows.forEach((row, i) => {
      const b = document.createElement("button");
      b.className = (row.kind === "add" ? "cue-ac-add" : "cue-ac-item") + (i === highlight ? " active" : "");
      b.textContent = row.kind === "add" ? `+ Add "${row.name}"` : row.name;
      b.addEventListener("mousedown", (e) => { e.preventDefault(); choose(view, i); });
      // Hovering a row makes it the (single) highlight - keyboard ↑/↓ and the mouse share one selection.
      b.addEventListener("mousemove", () => { if (highlight !== i) { highlight = i; render(view); } });
      el.appendChild(b);
    });
  };

  const choose = (view: EditorView, i: number): void => {
    const row = rows[i]; if (!row) return;
    if (row.kind === "add") addToCast(row.name);
    // Accept against the beat the popup is editing (not the live caret): in the browser the DOM
    // selection can drift out of a freshly-inserted cue, which would make a caret-based accept bail.
    const tr = (activeBeat ? acceptCueForBeat(view.state, activeBeat, row.name) : null)
      ?? acceptCue(view.state, row.name);  // wholesale replace + advance to content
    if (tr) view.dispatch(tr);
    close(); view.focus();
  };

  const update = (view: EditorView, ctx: ZoneState = context(view.state)): void => {
    viewRef = view;
    const c = ctx;
    // The popup belongs to an ACTIVE cue edit: closed whenever the editor is not focused
    // (clicked away), or the caret is not in a cue. So a stray transaction after a blur
    // never re-opens it over a lingering cue selection.
    if (!view.hasFocus() || c.zone?.role !== "cue" || !c.beat) return close();
    if (!open || c.beat.id !== activeBeat) {
      // Freshly entering a cue: open with the full cast, the buffer empty, and the
      // current speaker (if any) pre-highlighted - "pick a replacement".
      activeBeat = c.beat.id; query = ""; open = true; computeRows();
      const cur = c.zone.node.textContent.trim().toLowerCase();
      const idx = rows.findIndex((r) => r.kind === "pick" && r.name.toLowerCase() === cur);
      highlight = idx >= 0 ? idx : 0;
    }
    render(view);
    floating.show(() => anchorBelowCaret(viewRef!, el)); // show + glue to the caret on scroll
    // Click-away dismisses AND clears the cue highlight (the caret moves off the token). Idempotent.
    floating.dismissOnOutside(() => { if (viewRef) dismiss(viewRef); });
  };

  const handleKeyDown = (view: EditorView, event: KeyboardEvent): boolean => {
    if (!open) return false;
    const k = event.key;
    if (k === "ArrowDown") { if (rows.length) { highlight = (highlight + 1) % rows.length; render(view); } return true; }
    if (k === "ArrowUp") { if (rows.length) { highlight = (highlight - 1 + rows.length) % rows.length; render(view); } return true; }
    if (k === "Enter" || k === "Tab") { event.preventDefault(); choose(view, highlight); return true; }
    if (k === "Escape") { dismiss(view); return true; }
    if (k === "ArrowLeft" || k === "ArrowRight") { close(); return false; } // step out; the spine moves the caret
    if (k === "Backspace") {
      if (query.length === 0) { close(); return false; } // nothing buffered: let the spine clear/merge
      query = query.slice(0, -1); computeRows(); render(view); return true;
    }
    if (k === " ") {
      if (query.length === 0) { close(); return false; } // empty buffer + Space = "free text" (handled upstream)
      query += " "; computeRows(); render(view); return true; // names can have spaces ("OLD MAN")
    }
    // A printable key narrows the search - but NOT the structural punctuation the
    // surface owns ("(" opens a direction, "/" the special-insert menu).
    if (k.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && k !== "(" && k !== ")" && k !== "/") {
      event.preventDefault(); query += k; highlight = 0; computeRows(); render(view); return true;
    }
    return false;
  };

  return { update, handleKeyDown, isOpen: () => open, close };
}
