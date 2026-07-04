// The shared gutter-overlay lifecycle for the decoration plugins (writing-status / doc notes / comments /
// suggestions). Each lane is a layer appended to the SCROLL container (so it escapes the
// `.bubble{contain:layout}` / `.block{content-visibility:auto}` paint-clipping that hides in-doc widgets),
// with content-space top math + an off-screen cull. A plugin supplies only how to enumerate + build its chips.
//
// PERF (#audit): a single per-view CONDUCTOR drives every lane. The lanes share ONE rAF, ONE scroll/resize
// listener set, ONE read of the container rects per frame, and ONE per-frame cache of each node's top - so
// two lanes asking for the same beat's geometry read its `getBoundingClientRect` once, not twice. Relayout
// is still SKIPPED for a pure caret move (gutter chips are keyed to beats, not the selection - the dominant
// relayout trigger while typing); doc edits + meta pushes relayout every lane together through the one rAF.

import type { EditorView } from "prosemirror-view";
import type { EditorState, PluginView } from "prosemirror-state";

/** What a plugin's `paint` callback gets to place its chips. */
export interface GutterContext {
  view: EditorView;
  /** Content-space top for a node's DOM (with the +2 baseline), or null when it's scrolled off-screen
   *  (so the caller skips it - it gets re-placed on the next scroll). Cached per frame across all lanes. */
  topOf(dom: HTMLElement): number | null;
  /** Position `chip` in the gutter at `topPx` (content space) and append it to the layer. */
  add(chip: HTMLElement, topPx: number): void;
}

export interface GutterOverlayOpts {
  /** Layer class, e.g. "note-gutter". */
  className: string;
  /** Horizontal gap past the script column's edge - past the RIGHT edge by default, or LEFT of the
   *  LEFT edge when `side` is "left" (the icon gutter). */
  gap: number;
  /** Which margin the lane lives in (default "right" - notes / comments / suggestions). */
  side?: "left" | "right";
  /** Is the overlay showing anything right now (enabled AND has content)? Its work is skipped when false. */
  active(view: EditorView): boolean;
  /** Emit the chips for the currently-visible marked nodes, via `topOf` (cull) + `add` (place). */
  paint(ctx: GutterContext): void;
}

interface Lane { layer: HTMLElement; opts: GutterOverlayOpts }

interface Conductor {
  scroller: HTMLElement | null;
  lanes: Set<Lane>;
  schedule(): void;
  detach(lane: Lane): void;
}

// One conductor per editor view - all its gutter lanes share its rAF + listeners + per-frame layout reads.
const conductors = new WeakMap<EditorView, Conductor>();

function conductorFor(view: EditorView): Conductor {
  const existing = conductors.get(view);
  if (existing) return existing;

  const scroller = view.dom.parentElement;
  const lanes = new Set<Lane>();
  let raf = 0;

  const run = (): void => {
    raf = 0;
    const sc = view.dom.parentElement;
    if (!sc) return;
    // Read the container geometry ONCE for every lane this frame, and cache each node's content-space top
    // (the same for every lane), so overlapping lanes don't re-measure the same beat.
    const er = sc.getBoundingClientRect();
    const dr = view.dom.getBoundingClientRect();
    const tops = new Map<HTMLElement, number | null>();
    const topOf = (dom: HTMLElement): number | null => {
      const hit = tops.get(dom);
      if (hit !== undefined) return hit;
      const r = dom.getBoundingClientRect();
      const t = (r.bottom < er.top - 40 || r.top > er.bottom + 40) ? null : Math.round(r.top - er.top + sc.scrollTop + 2);
      tops.set(dom, t);
      return t;
    };
    for (const lane of lanes) {
      lane.layer.replaceChildren();
      if (!lane.opts.active(view)) continue;
      const leftPx = lane.opts.side === "left"
        ? Math.round(dr.left - er.left - lane.opts.gap)   // LEFT of the column - the icon gutter
        : Math.round(dr.right - er.left + lane.opts.gap);  // RIGHT of the column - notes / comments / suggestions
      const add = (chip: HTMLElement, topPx: number): void => {
        chip.style.top = `${topPx}px`;
        chip.style.left = `${leftPx}px`;
        lane.layer.appendChild(chip);
      };
      lane.opts.paint({ view, topOf, add });
    }
  };

  const schedule = (): void => { if (raf) return; raf = requestAnimationFrame(run); };
  scroller?.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);

  const conductor: Conductor = {
    scroller,
    lanes,
    schedule,
    detach: (lane) => {
      lanes.delete(lane);
      lane.layer.remove();
      if (lanes.size === 0) { // last lane gone - tear the conductor down
        scroller?.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        if (raf) cancelAnimationFrame(raf);
        conductors.delete(view);
      }
    },
  };
  conductors.set(view, conductor);
  return conductor;
}

/** Register a gutter-overlay lane. Call straight from a plugin's `view(editorView)`. */
export function createGutterOverlay(editorView: EditorView, opts: GutterOverlayOpts): PluginView {
  const layer = document.createElement("div");
  layer.className = opts.className;
  const conductor = conductorFor(editorView);
  conductor.scroller?.appendChild(layer);
  const lane: Lane = { layer, opts };
  conductor.lanes.add(lane);
  conductor.schedule(); // initial place (coalesced with every other lane registering this tick)
  return {
    update: (view: EditorView, prevState: EditorState) => {
      // A pure caret move never shifts a beat, so it never moves a chip - skip it. Doc edits (docChanged)
      // and meta pushes (neither touches the selection) fall through and relayout every lane via the one rAF.
      if (view.state.doc === prevState.doc && !view.state.selection.eq(prevState.selection)) return;
      conductor.schedule();
    },
    destroy: () => conductor.detach(lane),
  };
}
