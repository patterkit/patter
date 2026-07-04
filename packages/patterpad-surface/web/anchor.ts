// Position a floating popup just below the caret. `coordsAtPos` can fail or
// return 0,0 for an empty zone (no text to measure), which would leave a
// position:fixed popup in the top-left; so we validate it and fall back to the
// bounding rect of the DOM node at the caret.

import type { EditorView } from "prosemirror-view";

export function anchorBelowCaret(view: EditorView, el: HTMLElement): void {
  el.style.display = "block";
  let left: number | null = null;
  let top = 0;

  try {
    const c = view.coordsAtPos(view.state.selection.head);
    if (Number.isFinite(c.left) && (c.left !== 0 || c.bottom !== 0)) { left = c.left; top = c.bottom + 4; }
  } catch { /* fall through to the DOM rect */ }

  if (left === null) {
    try {
      const at = view.domAtPos(view.state.selection.head);
      const node = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : (at.node as HTMLElement);
      const r = (node ?? view.dom).getBoundingClientRect();
      left = r.left; top = r.bottom + 4;
    } catch {
      const r = view.dom.getBoundingClientRect();
      left = r.left; top = r.top + 40;
    }
  }

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/**
 * Keep a (viewport-fixed) popup glued to its anchor while the page scrolls or
 * resizes - otherwise it stays put as the content moves out from under it. Returns a
 * detach fn the popup calls when it closes. The capture-phase scroll listener also
 * catches the inner #editor scroll container, not just the window.
 */
export function followOnScroll(reposition: () => void): () => void {
  const onMove = (): void => reposition();
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); };
}
