// Drag-and-drop across the tree (groups §6 / §13.7). A pointer-based drag (not HTML5
// DnD, so it never fights ProseMirror's own drag handling): grab a node's handle and the
// drop seams NEAR the pointer - across all blocks and groups, so a snippet can move
// between blocks, into / out of groups, etc. - show as quiet grey dashed candidates; the
// nearest is the ACTIVE drop, an accent dashed line centred in an opened "make-room" gap.
// A seam that targets an EMPTY container highlights that container's ghost-snippet instead
// (the node will land in it). Release drops there via moveNodeTo, Escape cancels.
//
// Hit-testing geometry is FROZEN at drag start (the doc does not change during a drag),
// adjusted only for scroll. The make-room gap is therefore purely cosmetic - it never feeds
// back into which seam is nearest, so the target can't "run away" as the gap opens. Each
// seam's position is its gap MIDPOINT, so the bar sits midway between its two neighbours.

import type { EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { moveNodeTo, moveChunksAt, dropUnwrapsOption } from "../src/groups.js";
import { multiSelectPositions } from "../src/multiselect.js";
import { selectChunkAt } from "./chunkselect.js";
import { confirmDialog } from "./confirm.js";

type View = EditorView;
type GetPos = () => number | undefined;

interface Seam { pos: number; mid: number; left: number; width: number; ghost: HTMLElement | null } // mid = gap-free midpoint at drag start

const BAND = 150; // px: only seams within this vertical reach of the pointer are shown
const INSET = 8;  // px: hold the seam bar off the left rail / edges so it doesn't clash
const GAP = 16;   // px: how far make-room parts the neighbours (small, so the drop never runs away)
const FLIP_MS = 200; // ms: how long a dropped chunk eases from its old slot to its new one (mirrors CSS --dur-settle)

/**
 * Commit a move and FLIP-animate it: the reorder rebuilds the DOM, so every chunk snaps to its new
 * place. We record each chunk's screen rect FIRST (by stable data-id), dispatch, then INVERT - jump
 * each that moved back to its old rect with no transition - and PLAY: release to its real position
 * with a transition, so it eases over instead of popping. (Chunk wrappers set `ignoreMutation` for
 * chrome, so these inline-style writes don't trip ProseMirror's observer.)
 */
function commitWithFlip(view: View, tr: import("prosemirror-state").Transaction): void {
  const first = new Map<string, DOMRect>();
  view.dom.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => { if (el.dataset.id) first.set(el.dataset.id, el.getBoundingClientRect()); });
  view.dispatch(tr); // ProseMirror re-renders the move synchronously
  const moved: HTMLElement[] = [];
  view.dom.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
    const f = el.dataset.id ? first.get(el.dataset.id) : undefined;
    if (!f) return; // a brand-new chunk (a seeded option / ghost) - let it just appear
    const dx = f.left - el.getBoundingClientRect().left, dy = f.top - el.getBoundingClientRect().top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // didn't move
    el.style.transition = "none"; el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    moved.push(el);
  });
  if (moved.length === 0) return;
  void view.dom.offsetHeight; // force the inverted transforms to commit (the animation's start frame)
  // PLAY: release to identity with a transition - the committed inverse above is the "from", so the
  // transition animates without needing requestAnimationFrame (which a backgrounded tab can stall).
  for (const el of moved) { el.style.transition = `transform ${FLIP_MS}ms var(--ease-standard)`; el.style.transform = ""; }
  window.setTimeout(() => { for (const el of moved) { el.style.transition = ""; el.style.transform = ""; } }, FLIP_MS + 80);
}

let layer: HTMLElement | null = null;
function getLayer(): HTMLElement {
  if (!layer) { layer = document.createElement("div"); layer.className = "drop-layer"; document.body.appendChild(layer); }
  return layer;
}

/** The nearest scrollable ancestor (so frozen geometry can be re-projected as it scrolls). */
function scrollParent(el: HTMLElement): HTMLElement {
  let n = el.parentElement;
  while (n && n !== document.body) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") return n; n = n.parentElement; }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/** The valid drop seam POSITIONS for the dragged node (deduped): the gap before / after
 *  each chunk in any block or group, or between blocks for a block drag. Kept only when
 *  moveNodeTo accepts the target (its own seams, subtree, and type mismatches drop out). */
function collectSeamPositions(view: View, draggingBlock: boolean, accepts: (pos: number) => boolean): number[] {
  const doc = view.state.doc;
  const out: number[] = [];
  const push = (pos: number): void => { if (!out.includes(pos) && accepts(pos)) out.push(pos); };
  if (draggingBlock) {
    let p = 0; push(0);
    doc.forEach((b) => { p += b.nodeSize; push(p); });
  } else {
    doc.descendants((node, pos) => {
      if (node.type.name === "block" || node.type.name === "group") {
        // Seams only between CHUNKS. An option's leading prompt cell is not a chunk - skip it,
        // so a chunk is never dropped before the prompt (the prompt must stay first).
        let p = pos + 1, pushedFirst = false;
        node.forEach((child) => {
          if (child.type.name === "optionprompt") { p += child.nodeSize; return; }
          if (!pushedFirst) { push(p); pushedFirst = true; } // before the first chunk
          p += child.nodeSize; push(p);                       // after each chunk
        });
        if (!pushedFirst) push(p); // empty content run (after a lone prompt, or an empty container)
      }
      return true;
    });
  }
  return out;
}

/** Gap-free screen geometry for each seam, captured ONCE at drag start (the doc is static
 *  during a drag; later frames only subtract the scroll delta). `mid` is the seam's gap
 *  MIDPOINT - the visual middle between the two neighbours - so the bar sits centred between
 *  them. A seam into an EMPTY container instead carries that container's `ghost` element. */
function captureSeams(view: View, positions: number[], draggingBlock: boolean): Seam[] {
  const doc = view.state.doc;
  const ed = view.dom.getBoundingClientRect();
  const seams: Seam[] = [];
  for (const pos of positions) {
    let left = ed.left, width = ed.width, container: HTMLElement | null = null;
    if (!draggingBlock) {
      const $p = doc.resolve(pos);
      if ($p.depth >= 1) {
        container = view.nodeDOM($p.before($p.depth)) as HTMLElement | null;
        const r = container?.getBoundingClientRect();
        if (r) { left = r.left; width = r.width; }
      }
    }
    let mid: number, ghost: HTMLElement | null = null;
    const after = view.nodeDOM(pos);
    if (after instanceof HTMLElement) {                       // a seam before a chunk: midway from the prev chunk's bottom
      const lowerTop = after.getBoundingClientRect().top;
      const prev = after.previousElementSibling as HTMLElement | null;
      mid = ((prev ? prev.getBoundingClientRect().bottom : lowerTop) + lowerTop) / 2;
    } else {
      const before = doc.resolve(pos).nodeBefore;
      const lastDom = before ? view.nodeDOM(pos - before.nodeSize) as HTMLElement | null : null;
      if (lastDom) { mid = lastDom.getBoundingClientRect().bottom; }       // a container-END seam
      else {                                                                // an EMPTY container: target its ghost
        const g = container?.querySelector(":scope > .ghost-snippet") as HTMLElement | null;
        if (g) { const gr = g.getBoundingClientRect(); mid = (gr.top + gr.bottom) / 2; ghost = g; }
        else { try { mid = view.coordsAtPos(pos).top; } catch { continue; } }
      }
    }
    if (!Number.isFinite(mid)) continue;
    left += INSET; width = Math.max(0, width - 2 * INSET); // breathing room off the rail / edges
    seams.push({ pos, mid, left, width, ghost });
  }
  return seams;
}

/** A grip that drags this node (bubble / group / block) to a new seam (groups §6). */
export function makeDragHandle(view: View, getPos: GetPos): HTMLElement {
  const h = document.createElement("span"); h.className = "drag-handle"; h.textContent = "⠿"; h.dataset.tip = "drag to move"; h.contentEditable = "false";
  h.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const from = getPos(); if (from == null) return;
    // Shift / Cmd on the grip SELECTS rather than drags (the grip is the primary way to grab a chunk,
    // so modifier-grabbing must extend / toggle the multi-set, groups §6).
    if (e.shiftKey || e.metaKey || e.ctrlKey) { selectChunkAt(view, from, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); return; }
    const node = view.state.doc.nodeAt(from); if (!node) return;
    const draggingBlock = node.type.name === "block";
    // Multi-drag (groups §6): if this chunk is part of the multi-select set, drag the WHOLE set as one
    // (gathered, even if discontiguous like [1,2,4]).
    const setPositions = multiSelectPositions(view.state);
    const run = !draggingBlock && setPositions.length >= 2 && setPositions.includes(from) ? setPositions : null;
    const accepts = run
      ? (pos: number): boolean => !!moveChunksAt(view.state, run, pos)
      : (pos: number): boolean => !!moveNodeTo(view.state, from, pos);
    const positions = collectSeamPositions(view, draggingBlock, accepts);
    if (positions.length === 0) return; // nowhere valid to drop
    // The dragged element(s): every chunk in the set (or the single grabbed node), dimmed while moving.
    const sources: HTMLElement[] = [];
    if (run) { for (const p of run) { const dom = view.nodeDOM(p); if (dom instanceof HTMLElement) sources.push(dom); } }
    else { const s = view.nodeDOM(from); if (s instanceof HTMLElement) sources.push(s); }
    const scroller = scrollParent(view.dom);
    const base = captureSeams(view, positions, draggingBlock); // FROZEN, gap-free
    const startScroll = scroller.scrollTop;
    let started = false; // the drag visuals only begin once the pointer moves past the threshold; a
                         // plain click (no movement) instead SELECTS the node (so it never commits a
                         // spurious move - which, inside a choice, used to auto-wrap a new option).
    let pointerY = e.clientY;
    let activePos: number | null = null;

    // --- the make-room gap (inline margin, eased by the CSS transition on .bubble / .group-rail) ---
    let roomEl: HTMLElement | null = null;
    let roomProp: "marginTop" | "marginBottom" = "marginTop";
    const makeRoom = (seam: Seam | null): void => {
      let target: HTMLElement | null = null, prop: "marginTop" | "marginBottom" = "marginTop";
      if (seam && !seam.ghost) { // no gap when dropping into a ghost (it IS the target)
        const after = view.nodeDOM(seam.pos);
        if (after instanceof HTMLElement) { target = after; }
        else { // a container-END seam has no node after it: open the gap BELOW the last child
          const before = view.state.doc.resolve(seam.pos).nodeBefore;
          const dom = before ? view.nodeDOM(seam.pos - before.nodeSize) : null;
          if (dom instanceof HTMLElement) { target = dom; prop = "marginBottom"; }
        }
      }
      if (target !== roomEl || prop !== roomProp) {
        if (roomEl) roomEl.style[roomProp] = "";
        roomEl = target; roomProp = prop;
        // ADD the gap onto the element's resting margin (read with the inline override cleared), so
        // the `transition: margin` eases it OPEN. A flat `${GAP}px` would *shrink* the gap at a
        // container's end, where the last child's resting margin-bottom already exceeds GAP.
        if (roomEl) {
          const base = parseFloat(getComputedStyle(roomEl)[roomProp]) || 0;
          roomEl.style[roomProp] = `${base + GAP}px`;
        }
      }
    };

    // --- ghost highlight (when the target is an empty container's placeholder) ---
    let ghostEl: HTMLElement | null = null;
    const setGhost = (seam: Seam | null): void => {
      const g = seam ? seam.ghost : null;
      if (g === ghostEl) return;
      ghostEl?.classList.remove("drop-into"); ghostEl = g; ghostEl?.classList.add("drop-into");
    };

    // --- persistent bars (so they fade in / out and slide between seams) ---
    const bars = new Map<number, HTMLElement>();
    const ensureBar = (pos: number): HTMLElement => {
      let el = bars.get(pos);
      if (!el) {
        el = document.createElement("div"); el.className = "drop-seam";
        el.style.transition = "none"; // place at its real spot first (no fly-in from the corner)...
        getLayer().appendChild(el);
        bars.set(pos, el);
        const bar = el;
        requestAnimationFrame(() => { if (bar.isConnected) { bar.classList.add("shown"); bar.style.transition = ""; } }); // ...then fade in + enable the slide
      }
      return el;
    };
    const dropBar = (pos: number): void => {
      const el = bars.get(pos); if (!el) return;
      bars.delete(pos); el.classList.remove("shown", "active");
      window.setTimeout(() => el.remove(), 160); // remove after the fade-out
    };

    const nearest = (delta: number): Seam | null => {
      let best: Seam | null = null, bestD = Infinity;
      for (const s of base) { const d = Math.abs((s.mid - delta) - pointerY); if (d < bestD) { bestD = d; best = s; } }
      return best;
    };

    /** Position the bars. Hit geometry is frozen (s.mid - scrollDelta); the make-room gap shift
     *  is applied to the DRAWING only - the active bar centres in its opened gap, seams below
     *  ride down with the parted content - so bars stay aligned without perturbing the hit-test.
     *  A ghost-target seam draws no line (the ghost itself is highlighted instead). */
    const paint = (active: Seam | null): void => {
      const delta = scroller.scrollTop - startScroll;
      // Scroll tracking rides the LAYER (no transition -> instant), so the bars stay glued to the
      // script as it scrolls. Each bar's own transform is scroll-FREE (the frozen mid + the make-room
      // gap), so the transform transition only ever animates the genuine seam-to-seam slide -
      // never a scroll, which used to make the lines lag behind the content.
      getLayer().style.transform = `translateY(${-Math.round(delta)}px)`;
      const activeMid = active ? active.mid : 0;
      const seen = new Set<number>();
      for (const s of base) {
        const viewportY = s.mid - delta; // where the seam sits on screen now (for the band / pointer test)
        const isActive = !!active && s.pos === active.pos;
        if (!isActive && Math.abs(viewportY - pointerY) > BAND) continue; // only near the pointer (the active is always shown)
        if (s.ghost) continue; // ghost target: highlighted, not lined
        seen.add(s.pos);
        const el = ensureBar(s.pos);
        el.classList.toggle("active", isActive);
        let drawY = s.mid; // scroll-free; the layer applies the scroll delta
        if (active) { if (isActive) drawY += GAP / 2; else if (s.mid > activeMid) drawY += GAP; }
        el.style.width = `${Math.round(s.width)}px`;
        el.style.transform = `translate(${Math.round(s.left)}px, ${Math.round(drawY)}px)`;
      }
      for (const pos of [...bars.keys()]) if (!seen.has(pos)) dropBar(pos);
    };

    const reselect = (): void => { // pointer moved: re-pick the active seam (frozen geometry)
      const active = nearest(scroller.scrollTop - startScroll);
      activePos = active ? active.pos : null;
      makeRoom(active); setGhost(active); paint(active);
    };
    const redraw = (): void => { // scroll: keep the active seam, just re-project
      const active = activePos != null ? base.find((s) => s.pos === activePos) ?? null : null;
      makeRoom(active); setGhost(active); paint(active);
    };
    const end = (commit: boolean): void => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", redraw, true);
      document.body.classList.remove("is-dragging");
      for (const s of sources) s.classList.remove("drag-source");
      if (roomEl) roomEl.style[roomProp] = ""; roomEl = null;
      ghostEl?.classList.remove("drop-into"); ghostEl = null;
      for (const pos of [...bars.keys()]) dropBar(pos); // fade the bars out
      if (!started) { // a plain click on the grip (no drag): SELECT the whole node, never move it
        if (commit && !run) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, from))); // a run keeps its multi-selection
        view.focus();
        return;
      }
      if (commit && activePos != null) {
        const target = activePos;
        if (run) {
          const tr = moveChunksAt(view.state, run, target); if (tr) commitWithFlip(view, tr); // move the whole set (FLIP-animated)
        } else if (dropUnwrapsOption(view.state, from, target)) {
          // dragging an Option out of its choice dissolves it - confirm before committing (§7)
          confirmDialog({ title: "Ungroup this option?", body: "Moving an option out of its choice ungroups it - its contents move into the target. You can undo it.", confirmLabel: "Ungroup" })
            .then((ok) => { if (ok) { const tr = moveNodeTo(view.state, from, target); if (tr) commitWithFlip(view, tr); } view.focus(); });
          return;
        } else {
          const tr = moveNodeTo(view.state, from, target); if (tr) commitWithFlip(view, tr); // drop at the seam we showed (FLIP-animated)
        }
      }
      view.focus();
    };
    const onMove = (ev: MouseEvent): void => {
      pointerY = ev.clientY;
      if (!started) {
        if (Math.abs(ev.clientY - e.clientY) < 4) return; // below the threshold: still a click, not a drag
        started = true; // commit to a drag: now show the visuals
        document.body.classList.add("is-dragging");
        for (const s of sources) s.classList.add("drag-source");
      }
      reselect();
    };
    const onUp = (): void => end(true);
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === "Escape") { ev.preventDefault(); end(false); } };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", redraw, true); // track the document as it scrolls
  });
  return h;
}
