// ---------------------------------------------------------------------------
// Writing status (Patterpad #196): a per-beat authoring status (the ladder stub..locked, set up
// in Project Settings, each rung carrying a theme-palette colour). Source-language only - it lives
// in AuthoringFile.writing and never reaches the runtime bundle. The HOST owns the data + ladder;
// the surface only DISPLAYS and OFFERS to set it, two ways:
//   - the "Status" context-menu submenu (set one beat, or RIPPLE a container / selection's beats),
//   - an optional LEFT-gutter colour badge (View > Show line status; hidden in Writing View).
// Only LINE + PROSE beats carry a status - action atoms are never tracked (they carry no recordable
// line, mirroring the production report, which already skips them).
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { createGutterOverlay } from "./gutterlayer.js";
import { modelIdOf } from "../src/zoneutil.js";

/** One rung of the writing-status ladder, as the host hands it to the surface (name + palette slot). */
export interface WritingStatusRung { name: string; colour?: number }
/** beat id -> status name. */
export type WritingStatusMap = Record<string, string>;

// The ladder + the set-status handler are host-global (one editor); the per-beat map + the View
// toggle ride in plugin state (per view, meta-pushed - no doc change, so no dirty flag).
let ladder: WritingStatusRung[] = [];
export function setWritingStatusLadder(rungs: WritingStatusRung[]): void { ladder = rungs ?? []; }
export function writingStatusLadder(): WritingStatusRung[] { return ladder; }

type StatusFn = (ids: string[], status: string | null) => void;
let statusHandler: StatusFn | null = null;
export function setWritingStatusHandler(fn: StatusFn | null): void { statusHandler = fn; }
/** The "Status" submenu is offerable only when the host has wired a handler AND declared a ladder. */
export function writingStatusEnabled(): boolean { return statusHandler !== null && ladder.length > 0; }
/** Apply a status (null = clear) to these beats - routed to the host (it edits AuthoringFile.writing). */
export function applyWritingStatus(ids: string[], status: string | null): void { if (ids.length) statusHandler?.(ids, status); }

/** The palette slot (0-11) declared for a status name, or undefined (unknown / no colour). */
export function statusColourSlot(name: string): number | undefined { return ladder.find((r) => r.name === name)?.colour; }

/** Collect the ids of every LINE / PROSE beat at or under `node` (so a container / selection ripples to
 *  its descendant beats). Action atoms carry no status, so they're never collected. */
export function collectBeatIds(node: PMNode): string[] {
  const ids: string[] = [];
  const visit = (n: PMNode): void => {
    const t = n.type.name;
    if (t === "line" || t === "prose") { const id = modelIdOf(n); if (id) ids.push(id); return; }
    n.forEach((c) => visit(c));
  };
  visit(node);
  return ids;
}

// The per-beat status map + the SET of statuses to show ride in PLUGIN STATE, meta-pushed - the same
// pattern as the note / comment / suggestion gutters (docnotes.ts / comments.ts). `shown` is the list of
// status NAMES whose pills are revealed (Review > Line Status); empty = show none (the default).
interface StatusState { map: WritingStatusMap; shown: string[] }
const key = new PluginKey<StatusState>("patterWritingStatus");

const GUTTER_GAP = 12; // px LEFT of the script column - the icon gutter (the pill grows leftward from here)

/** The status badge for a beat: a PILL carrying the status NAME, tinted by the rung's palette slot - the
 *  text makes adjacent rungs unmistakable where bare colour dots blurred together. */
function statusPill(name: string): HTMLElement {
  const pill = document.createElement("span");
  pill.className = "status-pill"; pill.contentEditable = "false";
  pill.textContent = name;
  const slot = statusColourSlot(name);
  if (slot != null) {
    // A tinted chip (not a saturated fill): readable in every reading palette, the rung's hue carried by
    // the background wash, border, and text together.
    pill.style.background = `color-mix(in oklab, var(--char-${slot}) 20%, var(--surface))`;
    pill.style.borderColor = `color-mix(in oklab, var(--char-${slot}) 55%, var(--line))`;
    pill.style.color = `color-mix(in oklab, var(--char-${slot}) 72%, var(--ink))`;
  }
  pill.setAttribute("aria-label", `Writing status: ${name}`);
  return pill;
}

export function writingStatusPlugin(): Plugin<StatusState> {
  return new Plugin<StatusState>({
    key,
    state: {
      init: () => ({ map: {}, shown: [] }),
      apply: (tr, value) => (tr.getMeta(key) as StatusState | undefined) ?? value,
    },
    // A LEFT-gutter overlay (sibling of the doc on the scroll container, escaping the bubble/block paint
    // containment) holds the status pills, level with each line / prose beat.
    view(editorView) {
      return createGutterOverlay(editorView, {
        className: "status-gutter",
        gap: GUTTER_GAP,
        side: "left",
        active: (view) => {
          const st = key.getState(view.state);
          // Active only when at least one status is chosen to show AND there's a ladder. An unset beat
          // falls back to the lowest rung, so showing that rung reveals every otherwise-unset beat.
          // (Writing View hides the gutter via CSS - not here - so the pills repaint correctly on exit.)
          return !!st?.shown.length && ladder.length > 0;
        },
        paint: ({ view, topOf, add }) => {
          const st = key.getState(view.state); if (!st) return;
          const lowest = ladder[0]?.name; // unset beats default to the lowest rung of the ladder
          view.state.doc.descendants((node, pos) => {
            const t = node.type.name;
            if (t !== "line" && t !== "prose") return;
            const id = modelIdOf(node); if (!id) return;
            const name = st.map[id] ?? lowest; if (!name) return; // no ladder at all -> nothing to show
            if (!st.shown.includes(name)) return; // only the chosen rungs are revealed
            const dom = view.nodeDOM(pos);
            if (!(dom instanceof HTMLElement)) return;
            const top = topOf(dom);
            if (top == null) return; // off-screen
            add(statusPill(name), top);
          });
        },
      });
    },
  });
}

/** Push partial plugin state (the map and/or the shown set) - a meta-only transaction. */
function patch(view: EditorView, next: Partial<StatusState>): void {
  const cur = key.getState(view.state) ?? { map: {}, shown: [] };
  view.dispatch(view.state.tr.setMeta(key, { ...cur, ...next }));
}
/** Replace the per-beat status map (the visible pills repaint). */
export function setWritingStatusMap(view: EditorView, map: WritingStatusMap): void { patch(view, { map }); }
/** The status explicitly set on a beat, or undefined when unset (the menu ticks the EFFECTIVE rung, so
 *  callers treat undefined as the lowest rung - unset == lowest). */
export function writingStatusOf(view: EditorView, id: string): string | undefined { return key.getState(view.state)?.map[id]; }
/** Set which status names show their gutter pill (Review > Line Status); empty = none. */
export function setWritingStatusShown(view: EditorView, shown: string[]): void { patch(view, { shown }); }
