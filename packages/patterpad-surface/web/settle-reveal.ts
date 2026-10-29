// ---------------------------------------------------------------------------
// A reveal that lands where it meant to. The page's blocks use `content-visibility: auto`, so a block that has
// never been drawn is laid out at an estimated height (`contain-intrinsic-block-size`) until it is. Centring a
// node straight after a scene loads aims at a page made of estimates; as the blocks above it draw at their
// real heights, the node moves, and the scroll ends somewhere else (the resolver's Edit, a search hit or a
// problem on a scene's first load, the October 2026 live check). Once a block has been drawn its real height
// is remembered, which is why a second jump always landed.
//
// So after the first scroll, watch where the node actually is, and once scrolling has stopped, centre it again
// if it has drifted. A few passes settle it; the watch gives up if the author moves on (the caret leaves the
// node) or after a short budget, so it never fights a scroll the author starts.
// ---------------------------------------------------------------------------

/** How far from the viewport's centre a revealed node may sit (as a share of the viewport's height) before it
 *  counts as drifted. */
const DRIFT = 0.25;
/** Re-centring passes before giving up. */
const MAX_PASSES = 4;
/** The longest the watch runs, in milliseconds. */
const BUDGET_MS = 1500;

/** The nearest ancestor that scrolls, or the document's scrolling element. */
function scroller(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Whether `el` sits near the middle of its scroller's visible area. */
export function nearCentre(el: HTMLElement, box: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const v = box === document.scrollingElement || box === document.documentElement
    ? { top: 0, height: window.innerHeight }
    : (() => { const b = box.getBoundingClientRect(); return { top: b.top, height: b.height }; })();
  if (v.height <= 0) return true;
  const mid = r.top + Math.min(r.height, v.height) / 2;
  return Math.abs(mid - (v.top + v.height / 2)) <= v.height * DRIFT;
}

/**
 * Keep centring `el` until it stays put. Call it straight after the first `scrollIntoView`. `stillWanted`
 * says whether the reveal still matters (false once the author has moved the caret elsewhere); `frame` and
 * `now` are injectable for tests.
 */
export function settleReveal(
  el: HTMLElement,
  stillWanted: () => boolean,
  frame: (fn: () => void) => void = (fn) => { requestAnimationFrame(fn); },
  now: () => number = () => performance.now(),
): void {
  const box = scroller(el);
  const start = now();
  let passes = 0;
  let lastTop = box.scrollTop;
  let still = 0;
  const tick = (): void => {
    if (!el.isConnected || !stillWanted() || now() - start > BUDGET_MS) return;
    // Wait for the scroll (a smooth one included) to stop: two frames at the same position.
    if (box.scrollTop !== lastTop) { lastTop = box.scrollTop; still = 0; frame(tick); return; }
    if (++still < 2) { frame(tick); return; }
    if (nearCentre(el, box)) return;
    if (++passes > MAX_PASSES) return;
    el.scrollIntoView({ block: "center", behavior: "auto" });
    lastTop = box.scrollTop; still = 0;
    frame(tick);
  };
  frame(tick);
}
