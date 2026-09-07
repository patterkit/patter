// Position a floating popup just below the caret, KEPT INSIDE THE VIEWPORT. `coordsAtPos` can fail
// or return 0,0 for an empty zone (no text to measure), which would leave a position:fixed popup in
// the top-left; so we validate it and fall back to the bounding rect of the DOM node at the caret.
//
// The clamping is not a nicety. Below the caret is where a popup wants to be, but the `/` menu is
// ~350px of items and the jump picker up to 22rem, so a caret in the lower half of the window put
// most of the list off the bottom edge with no way to scroll or reach it: on a 560px-tall window the
// menu opened at y=484 and one of its ten items was reachable (#63). So: flip ABOVE the caret when
// that fits better, and clamp to the viewport either way. The element-anchored path in targetpicker
// has always clamped; this is the same rule for the caret.

import type { EditorView } from "prosemirror-view";

const MARGIN = 8;  // breathing room at the viewport edge
const GAP = 4;     // between the caret line and the panel

export function anchorBelowCaret(view: EditorView, el: HTMLElement): void {
  el.style.display = "block";
  let left: number | null = null;
  let above = 0;  // y of the caret's TOP (a flipped panel sits above this)
  let below = 0;  // y of the caret's BOTTOM (a normal panel hangs from this)

  try {
    const c = view.coordsAtPos(view.state.selection.head);
    if (Number.isFinite(c.left) && (c.left !== 0 || c.bottom !== 0)) { left = c.left; above = c.top; below = c.bottom; }
  } catch { /* fall through to the DOM rect */ }

  if (left === null) {
    try {
      const at = view.domAtPos(view.state.selection.head);
      const node = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : (at.node as HTMLElement);
      const r = (node ?? view.dom).getBoundingClientRect();
      left = r.left; above = r.top; below = r.bottom;
    } catch {
      const r = view.dom.getBoundingClientRect();
      left = r.left; above = r.top + 40; below = r.top + 40;
    }
  }

  // Measure AFTER display:block, so a menu that has just been filled reports its real size.
  const h = el.offsetHeight || 0;
  const w = el.offsetWidth || 0;
  const vw = window.innerWidth, vh = window.innerHeight;

  let top = below + GAP;
  if (top + h > vh - MARGIN) {
    const flipped = above - GAP - h;                 // above the caret line
    top = flipped >= MARGIN ? flipped                // it fits up there: flip
      : Math.max(MARGIN, vh - MARGIN - h);           // fits neither way: sit on the bottom edge
  }
  el.style.left = `${Math.round(Math.max(MARGIN, Math.min(left, vw - w - MARGIN)))}px`;
  el.style.top = `${Math.round(top)}px`;
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
