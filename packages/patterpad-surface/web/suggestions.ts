// ---------------------------------------------------------------------------
// "Suggest a rewrite" markers, surfaced in the script (review flow,
// design/proposals/suggest-rewrite.md). A ProseMirror plugin (mirrors
// comments.ts / docnotes.ts) that overlays a beat carrying open rewrite
// proposals: a tint on the say text (`has-suggestion`) + a clickable pencil
// MARKER out in the right gutter (its own lane, outside the note + comment
// lanes). Clicking opens the host's review popover. The host pushes the visible
// set via setSuggestions; creation + accept/reject are host actions (the editor
// never owns the proposal text). Whole-beat anchored - no sub-range maths.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import { createGutterOverlay } from "./gutterlayer.js";
import { findBeatById, findBeatsByIds } from "../src/zoneutil.js";

/** One open suggestion to surface on a beat: its id, the beat it anchors to, a hover preview, and whether
 *  it's STALE (its baseline no longer matches the live text - the line changed since it was suggested). */
export interface SuggestionMark {
  id: string;
  nodeId: string;
  author: string;
  /** Hover tooltip ("author proposes: …"). */
  preview?: string;
  /** The baseline no longer matches the live say text - shown muted, re-diffed against current on review. */
  stale?: boolean;
}

/** What a marker click (or the context-menu item) hands the host. `create` = start a NEW suggestion
 *  (the prefilled rewrite modal); otherwise REVIEW the beat's existing suggestion(s). */
export interface SuggestionOpenRequest {
  nodeId: string;
  create?: boolean;
  anchor: HTMLElement;
}

type OpenFn = (req: SuggestionOpenRequest) => void;
let openHandler: OpenFn | null = null;
export function setSuggestionHandler(fn: OpenFn | null): void { openHandler = fn; }
export function suggestionsEnabled(): boolean { return openHandler !== null; }

/** Start a NEW suggestion on a beat - the context-menu "Suggest rewrite…" routes here; the host opens a
 *  modal prefilled with the current say text. Anchors to the beat's DOM. */
export function startSuggestion(view: EditorView, beatId: string, fallbackAnchor: HTMLElement): void {
  if (!openHandler) return;
  const beat = findBeatById(view.state.doc, beatId);
  const dom = beat ? view.nodeDOM(beat.pos) : null;
  openHandler({ nodeId: beatId, create: true, anchor: dom instanceof HTMLElement ? dom : fallbackAnchor });
}

const key = new PluginKey<SuggestionMark[]>("patterSuggestions");
const SUGGESTION_GAP = 52; // px from the column's right edge - the OUTERMOST lane (comments 8, notes 30)

// A filled pencil glyph (inherits currentColor - no colour emoji, matching the app's icons).
const PENCIL_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M11.7 1.3a1.5 1.5 0 0 1 2.1 2.1l-.9.9-2.1-2.1.9-.9Zm-1.6 1.6 2.1 2.1-6.8 6.8-2.7.6.6-2.7 6.8-6.8Z"/></svg>';

function marker(nodeId: string, group: SuggestionMark[]): HTMLElement {
  const b = document.createElement("button");
  b.className = `suggestion-marker${group.some((m) => m.stale) ? " stale" : ""}`;
  b.type = "button"; b.contentEditable = "false";
  b.dataset.tip = group.length === 1 ? (group[0]!.preview ?? "Suggested rewrite") : `${group.length} suggested rewrites`; b.setAttribute("aria-label", "Suggested rewrite");
  b.innerHTML = PENCIL_SVG;
  if (group.length > 1) { const n = document.createElement("span"); n.className = "suggestion-count"; n.textContent = String(group.length); b.appendChild(n); }
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); openHandler?.({ nodeId, anchor: b }); });
  return b;
}

export function suggestionsPlugin(): Plugin<SuggestionMark[]> {
  return new Plugin<SuggestionMark[]>({
    key,
    state: {
      init: () => [],
      apply: (tr, value) => (tr.getMeta(key) as SuggestionMark[] | undefined) ?? value,
    },
    props: {
      decorations(state) {
        const marks = key.getState(state) ?? [];
        if (!marks.length) return null;
        const beats = findBeatsByIds(state.doc, new Set(marks.map((m) => m.nodeId))); // one walk for all marked beats
        const decos: Decoration[] = [];
        for (const [, beat] of beats) decos.push(Decoration.node(beat.pos, beat.pos + beat.node.nodeSize, { class: "has-suggestion" }));
        return DecorationSet.create(state.doc, decos);
      },
    },
    // Gutter overlay (a sibling of the doc on the scroll container - escapes bubble/block paint containment,
    // like the note / comment overlays). One pencil per beat with open suggestion(s).
    view(editorView) {
      return createGutterOverlay(editorView, {
        className: "suggestion-gutter",
        gap: SUGGESTION_GAP,
        active: (view) => suggestionsEnabled() && (key.getState(view.state) ?? []).length > 0,
        paint: ({ view, topOf, add }) => {
          const marks = key.getState(view.state) ?? [];
          const byBeat = new Map<string, SuggestionMark[]>();
          for (const m of marks) { const a = byBeat.get(m.nodeId) ?? []; a.push(m); byBeat.set(m.nodeId, a); }
          const beats = findBeatsByIds(view.state.doc, new Set(byBeat.keys())); // one walk, not one per beat-group
          for (const [nodeId, group] of byBeat) {
            const beat = beats.get(nodeId);
            if (!beat) continue;
            const dom = view.nodeDOM(beat.pos);
            if (!(dom instanceof HTMLElement)) continue;
            const top = topOf(dom);
            if (top == null) continue; // off-screen
            add(marker(nodeId, group), top);
          }
        },
      });
    },
  });
}

/** Replace the visible suggestion set (a meta-only transaction - no doc change, no dirty). */
export function setSuggestions(view: EditorView, marks: SuggestionMark[]): void {
  view.dispatch(view.state.tr.setMeta(key, marks));
}
