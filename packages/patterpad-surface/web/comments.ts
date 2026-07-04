// ---------------------------------------------------------------------------
// Threaded editor comments, surfaced in the script (collaboration, #148). A
// ProseMirror plugin (mirrors docnotes.ts / problems.ts) that overlays comment
// threads as DECORATIONS so they survive editing re-renders:
//   - a RANGE thread highlights its span of say text + flies a small bubble at
//     the span's end (Word/Docs style);
//   - a WHOLE-BEAT thread (no range) flies a gutter bubble on the beat.
// A range is CONTENT-anchored: stored as plain-text offsets + the quoted text,
// re-found by its quote each render (offsets are a hint), and LIVE-mapped through
// edits within a session so the highlight tracks typing. A thread whose quote no
// longer exists is shown demoted to a gutter bubble (orphaned), never lost.
// The plugin's `view` also raises a floating "Comment" affordance over a non-empty
// text selection, so a range thread starts from selecting words.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import { createGutterOverlay } from "./gutterlayer.js";
import { modelIdOf, sayStartOf, sayText, findBeatById, findBeatsByIds } from "../src/zoneutil.js";

/** One visible thread to surface: its id, the beat it anchors to, an optional span (plain-text offsets
 *  + quote), and the badge facts. No range => a whole-beat thread. */
export interface CommentMark {
  id: string;
  nodeId: string;
  from?: number;
  to?: number;
  quote?: string;
  count: number;
  resolved: boolean;
  /** The thread rendered for a hover tooltip ("author: body" lines), so it reads in place. */
  preview?: string;
}

/** What a bubble / selection affordance hands the host to open or start a thread. */
export interface CommentOpenRequest {
  nodeId: string;
  /** Present when opening an EXISTING thread (a bubble click). */
  threadId?: string;
  /** Present when STARTING a range thread from a selection (plain-text offsets + quote). */
  range?: { from: number; to: number; quote: string };
  /** The element to anchor the popover to. */
  anchor: HTMLElement;
}

type OpenFn = (req: CommentOpenRequest) => void;
let openHandler: OpenFn | null = null;
export function setCommentHandler(fn: OpenFn | null): void { openHandler = fn; }
export function commentsEnabled(): boolean { return openHandler !== null; }

/** True when a non-empty selection sits within a single say zone - i.e. a RANGE comment can be started.
 *  The action menu uses this to decide whether "Add comment" targets the selection or the whole beat. */
export function hasSaySelection(state: EditorState): boolean { return sayContextAt(state) !== null; }

/** Start a comment from the context menu (the floating affordance was removed): a RANGE thread when there
 *  is a say-text selection, else a WHOLE-BEAT thread on `beatId`. Anchors the popover to the beat's DOM. */
export function startComment(view: EditorView, beatId: string | null, fallbackAnchor: HTMLElement): void {
  if (!openHandler) return;
  const sel = sayContextAt(view.state);
  const nodeId = sel ? sel.nodeId : beatId;
  if (!nodeId) return;
  const beat = findBeatById(view.state.doc, nodeId);
  const dom = beat ? view.nodeDOM(beat.pos) : null;
  const anchor = dom instanceof HTMLElement ? dom : fallbackAnchor;
  if (sel) {
    const { from, to } = view.state.selection;
    const quote = view.state.doc.textBetween(from, to);
    openHandler({ nodeId: sel.nodeId, range: { from: from - sel.sayStart, to: to - sel.sayStart, quote }, anchor });
  } else {
    openHandler({ nodeId, anchor });
  }
}

const key = new PluginKey<PluginState>("patterComments");

const BUBBLE_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 2.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7.4l-3.1 2.5A.5.5 0 0 1 3.5 13.6v-1.6a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/></svg>';
const COMMENT_GAP = 8; // px from the column's right edge - the INNER gutter lane (the note chip sits just outside)

/** A thread resolved against the live doc: its mark + current PM span (null = whole-beat or orphaned). */
interface Resolved { mark: CommentMark; from: number | null; to: number | null }
interface PluginState { byId: Map<string, Resolved> }

/** Resolve a mark's stored offsets + quote to a live PM span, or null (whole-beat / orphaned). The quote
 *  is authoritative: if it isn't at the stored offsets, search the say text for it (offsets disambiguate
 *  only loosely); if it's gone entirely, orphan. */
function resolveSpan(doc: import("prosemirror-model").Node, mark: CommentMark): { from: number; to: number } | null {
  if (mark.quote == null || mark.from == null || mark.to == null) return null; // whole-beat thread
  const sayStart = sayStartOf(doc, mark.nodeId);
  if (sayStart < 0) return null; // beat gone -> orphan
  const beat = findBeatById(doc, mark.nodeId);
  if (!beat) return null;
  const text = sayText(beat.node);
  if (text.slice(mark.from, mark.to) === mark.quote) return { from: sayStart + mark.from, to: sayStart + mark.to };
  const idx = text.indexOf(mark.quote);
  if (idx >= 0) return { from: sayStart + idx, to: sayStart + idx + mark.quote.length };
  return null; // quote edited away -> orphan (shown as a gutter bubble)
}

/** The hover tooltip for a thread: the messages ("author: body" lines), so it reads in place; a bare
 *  label when the host pushed no preview. An orphaned thread (its quoted text was edited away) is flagged
 *  above the preview so the reader knows why it slid to the gutter. */
function tooltipOf(mark: CommentMark, orphaned: boolean): string {
  const note = orphaned ? "(the text this marked has changed)\n" : "";
  return note + (mark.preview ?? "Comment");
}

function bubble(mark: CommentMark, orphaned: boolean): HTMLElement {
  const b = document.createElement("button");
  b.className = `comment-bubble${mark.resolved ? " resolved" : ""}${orphaned ? " orphaned" : ""}`;
  b.type = "button"; b.contentEditable = "false";
  b.dataset.tip = tooltipOf(mark, orphaned); b.setAttribute("aria-label", "Comment");
  b.innerHTML = BUBBLE_SVG;
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); openHandler?.({ nodeId: mark.nodeId, threadId: mark.id, anchor: b }); });
  return b;
}

/** The say zone the selection sits wholly within (both ends), with its content-start, or null. */
function sayContextAt(state: EditorState): { nodeId: string; sayStart: number } | null {
  const { $from, $to, empty } = state.selection;
  if (empty) return null;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "say") {
      const sayStart = $from.start(d);
      const sayEnd = $from.end(d);
      if ($to.pos >= sayStart && $to.pos <= sayEnd) {
        const id = modelIdOf($from.node(d - 1));
        if (id) return { nodeId: id, sayStart };
      }
      return null;
    }
  }
  return null;
}

export function commentsPlugin(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key,
    state: {
      init: () => ({ byId: new Map() }),
      apply(tr, value, _old, newState) {
        const meta = tr.getMeta(key) as CommentMark[] | undefined;
        if (meta) {
          // Host pushed a fresh set: re-resolve every thread from its offsets + quote.
          const byId = new Map<string, Resolved>();
          for (const mark of meta) { const span = resolveSpan(newState.doc, mark); byId.set(mark.id, { mark, from: span?.from ?? null, to: span?.to ?? null }); }
          return { byId };
        }
        if (tr.docChanged) {
          // Live-map spans through the edit so a highlight tracks typing within the session.
          const byId = new Map<string, Resolved>();
          for (const [id, r] of value.byId) {
            byId.set(id, { mark: r.mark, from: r.from == null ? null : tr.mapping.map(r.from), to: r.to == null ? null : tr.mapping.map(r.to, -1) });
          }
          return { byId };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const ps = key.getState(state);
        if (!ps || !ps.byId.size) return null;
        // The whole-beat / orphaned threads tag their beat node; resolve all those beats in ONE doc walk.
        const wholeBeatIds = new Set<string>();
        for (const [, r] of ps.byId) if (!(r.from != null && r.to != null && r.from < r.to)) wholeBeatIds.add(r.mark.nodeId);
        const beats = findBeatsByIds(state.doc, wholeBeatIds);
        const decos: Decoration[] = [];
        for (const [, r] of ps.byId) {
          if (r.from != null && r.to != null && r.from < r.to) {
            // A live range: highlight the span in place (hover reads the thread; click opens it). The
            // clickable speech-bubble itself lives out in the gutter overlay (see view()).
            decos.push(Decoration.inline(r.from, r.to, { class: r.mark.resolved ? "comment-range resolved" : "comment-range", "data-tip": tooltipOf(r.mark, false) }));
          } else {
            // Whole-beat thread, OR a range whose quote was edited away (orphaned): just tag the beat (its
            // gutter bubble is drawn by the overlay).
            const beat = beats.get(r.mark.nodeId);
            if (beat) decos.push(Decoration.node(beat.pos, beat.pos + beat.node.nodeSize, { class: "has-comment" }));
          }
        }
        return DecorationSet.create(state.doc, decos);
      },
      // Click anywhere on a commented span opens its thread (the natural "what does this say?" gesture).
      // Not consumed (caret still places) and the popover does not steal focus from the editor.
      handleClick(view, pos, event) {
        const ps = key.getState(view.state);
        if (!ps) return false;
        for (const [, r] of ps.byId) {
          if (r.from != null && r.to != null && pos >= r.from && pos < r.to) {
            const el = (event.target as HTMLElement | null)?.closest?.(".comment-range") as HTMLElement | null;
            openHandler?.({ nodeId: r.mark.nodeId, threadId: r.mark.id, anchor: el ?? view.dom });
            return false;
          }
        }
        return false;
      },
    },
    // A gutter speech-bubble per commented beat, OUT in the right gutter (so it's obvious where the threads
    // are). Inner lane; the note chip takes the outer lane. A beat may hold several threads: stack them down
    // (+20px each). (Comments are STARTED from the context menu's "Add comment" - see startComment.)
    view(editorView) {
      return createGutterOverlay(editorView, {
        className: "comment-gutter",
        gap: COMMENT_GAP,
        active: (view) => { const ps = key.getState(view.state); return commentsEnabled() && !!ps && ps.byId.size > 0; },
        paint: ({ view, topOf, add }) => {
          const ps = key.getState(view.state);
          if (!ps) return;
          const beats = findBeatsByIds(view.state.doc, new Set([...ps.byId.values()].map((r) => r.mark.nodeId))); // one walk, not one per thread
          const perBeat = new Map<string, number>(); // a beat may hold several threads: stack them down
          for (const [, r] of ps.byId) {
            const beat = beats.get(r.mark.nodeId);
            if (!beat) continue;
            const dom = view.nodeDOM(beat.pos);
            if (!(dom instanceof HTMLElement)) continue;
            const top = topOf(dom);
            if (top == null) continue; // off-screen
            const n = perBeat.get(r.mark.nodeId) ?? 0; perBeat.set(r.mark.nodeId, n + 1);
            const orphaned = r.mark.from != null && r.from == null; // a range whose quoted text was edited away
            add(bubble(r.mark, orphaned), top + n * 20);
          }
        },
      });
    },
  });
}

/** Replace the visible comment set (a meta-only transaction - no doc change, no dirty). */
export function setComments(view: EditorView, marks: CommentMark[]): void {
  view.dispatch(view.state.tr.setMeta(key, marks));
}

/** Read the threads' CURRENT spans back as plain-text offsets (+ quote) - so the host can refresh stored
 *  offsets at save time after in-session edits moved them. Whole-beat / orphaned threads are omitted. */
export function commentRanges(view: EditorView): Array<{ id: string; from: number; to: number; quote: string }> {
  const ps = key.getState(view.state);
  if (!ps) return [];
  const out: Array<{ id: string; from: number; to: number; quote: string }> = [];
  for (const [id, r] of ps.byId) {
    if (r.from == null || r.to == null) continue;
    const sayStart = sayStartOf(view.state.doc, r.mark.nodeId);
    if (sayStart < 0) continue;
    out.push({ id, from: r.from - sayStart, to: r.to - sayStart, quote: view.state.doc.textBetween(r.from, r.to) });
  }
  return out;
}
