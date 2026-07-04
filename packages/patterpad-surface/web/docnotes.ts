// ---------------------------------------------------------------------------
// Documentation notes, surfaced in the script (spec §18, Patterpad reading layer).
// A ProseMirror plugin (mirrors problems.ts / comments.ts) that overlays the
// host-supplied, already-filtered notes as DECORATIONS so they survive editing
// re-renders. Where a node has a note, a small note ICON sits in the right gutter:
// hovering it shows the note(s) (a tooltip), clicking it opens the note editor
// (routed to the host). The host pushes the visible set (filtered by the View >
// Documentation menu) via setDocNotes; adding a note where none exists is a host
// action too (the right-click "Note…" menu), so the editor never owns note text.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { createGutterOverlay } from "./gutterlayer.js";
import { tipBold } from "./tooltip.js";
import { modelIdOf } from "../src/zoneutil.js";

/** One visible note: its class (for the label) + text. */
export interface DocNote { cls: string; text: string }
/** node/scene id -> its visible notes. */
export type DocNoteMap = Record<string, DocNote[]>;

type NoteFn = (nodeId: string, anchor: HTMLElement, kind?: string) => void;
// The note icon + the right-click "Note…" menu route through one host handler, set at mount.
let noteHandler: NoteFn | null = null;
export function setNoteHandler(fn: NoteFn | null): void { noteHandler = fn; }
export function notesEnabled(): boolean { return noteHandler !== null; }
/** Open / add a note on a node (the right-click "Note…" item routes here; `kind` narrows note classes). */
export function openNoteFor(nodeId: string, anchor: HTMLElement, kind?: string): void { noteHandler?.(nodeId, anchor, kind); }

// The note map PLUS the computed reading-layer decoration set: caching the set in plugin state (recomputed
// only on a notes push or a doc edit) keeps PM's per-update `decorations` prop a cheap lookup instead of two
// full-doc walks on every caret move. Mirrors spellcheck.ts / problems.ts.
interface DocNoteState { map: DocNoteMap; deco: DecorationSet }
const key = new PluginKey<DocNoteState>("patterDocNotes");

// Short forms for the hover tooltip. "everyone" / untyped get NO prefix; vo / loc abbreviated; studio
// classes capitalised.
const CLASS_LABEL: Record<string, string> = { vo: "VO", loc: "Loc" };
const labelOf = (cls: string): string => (cls === "" || cls === "everyone") ? "" : (CLASS_LABEL[cls] ?? (cls[0]!.toUpperCase() + cls.slice(1)));
const tooltipOf = (notes: DocNote[]): string => notes.map((n) => { const l = labelOf(n.cls); return l ? `${tipBold(`${l}:`)} ${n.text}` : n.text; }).join("\n");
// A content signature so a widget's key CHANGES when its notes do - else PM reuses the cached DOM and
// the under-heading text goes stale after an edit / filter toggle.
const sigOf = (notes: DocNote[]): string => notes.map((n) => `${n.cls}=${n.text}`).join("|");

// A monochrome, FILLED "note page" glyph - a document with its text lines punched out (fill-rule
// evenodd, so the lines show the background through and stay theme-proof). Filled + solid colour reads
// far more clearly in the gutter than a thin outline. Inherits currentColor (no colour emoji).
const NOTE_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M3.4 1.4h5.3L12.6 5.3v8.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V2.6A1.2 1.2 0 0 1 3.4 1.4ZM4.9 6.8h6.2v1.1H4.9Zm0 2.1h6.2v1.1H4.9Zm0 2.1h3.7v1.1H4.9Z"/></svg>';

/** The clickable note icon for the right gutter: hover reads the note(s), click opens the editor. */
function noteIcon(nodeId: string, kind: string | undefined, notes: DocNote[]): HTMLElement {
  const b = document.createElement("button");
  b.className = "note-icon"; b.type = "button"; b.contentEditable = "false";
  b.dataset.tip = tooltipOf(notes); b.setAttribute("aria-label", "Documentation notes");
  b.innerHTML = NOTE_SVG;
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); noteHandler?.(nodeId, b, kind); });
  return b;
}

/** The visible note text under a SCENE / BLOCK heading (the reading layer): each note shown in place,
 *  the whole block clickable to open the editor. Headers show their notes as text (no gutter chip) so
 *  the establishing context reads without hovering. */
function underHeading(nodeId: string, kind: string, notes: DocNote[]): HTMLElement {
  const wrap = document.createElement("div");
  // A block heading / group rail head is indented past its drag grip, so their notes indent to match
  // the TITLE / type label (not the grip); a scene title and a (headerless) snippet stay flush.
  const indented = kind === "block" || kind === "group";
  wrap.className = indented ? "doc-underhead doc-underhead-indent" : "doc-underhead";
  wrap.contentEditable = "false";
  wrap.dataset.tip = "Click to edit notes";
  for (const n of notes) {
    const line = document.createElement("div"); line.className = "doc-underhead-line";
    const l = labelOf(n.cls);
    if (l) { const lbl = document.createElement("span"); lbl.className = "doc-underhead-cls"; lbl.textContent = l; line.append(lbl); }
    line.append(document.createTextNode(n.text));
    wrap.append(line);
  }
  wrap.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); noteHandler?.(nodeId, wrap, kind); });
  return wrap;
}

const GUTTER_GAP = 30; // px from the column's right edge - the OUTER lane (comments take the inner lane)

/** Walk the doc once, building the reading-layer note decorations: under-heading text for the scene +
 *  containers, a gutter-bound node mark for beats. */
function computeNoteDecos(doc: PMNode, map: DocNoteMap): DecorationSet {
  if (!Object.keys(map).length) return DecorationSet.empty;
  const decos: Decoration[] = [];

  // SCENE + BLOCK headers show their notes as VISIBLE TEXT under the heading (the reading layer),
  // clickable to edit - no gutter chip for them. The under-head block sits INSIDE the column, so it
  // isn't clipped by containment (unlike a gutter chip would be).
  try {
    const sceneId = (JSON.parse(doc.attrs.raw as string) as { id?: string }).id;
    const sceneNotes = sceneId ? map[sceneId] : undefined;
    if (sceneId && sceneNotes?.length) {
      decos.push(Decoration.widget(0, () => underHeading(sceneId, "scene", sceneNotes), { side: -1, key: `docnote-scene-${sceneId}-${sigOf(sceneNotes)}` }));
    }
  } catch { /* malformed scene raw - skip */ }

  // CONTAINERS (block / snippet / group) show their notes as visible reading-layer TEXT too: a
  // block's under its heading; a snippet's / group's ABOVE the bubble (like the scene). Only BEATS
  // keep a gutter CHIP - it can't be a widget here, since `.bubble` (contain:layout) and `.block`
  // (content-visibility:auto = paint containment) clip anything painted outside their box.
  doc.descendants((node, pos) => {
    const id = modelIdOf(node);
    if (!id) return;
    const notes = map[id];
    if (!notes?.length) return;
    const t = node.type.name;
    if (t === "block" || t === "group") {
      // UNDER the heading / rail head: a widget at the top of the container body (pos + 1, which
      // maps into the contentDOM). Covers every group type - choice, option, sequence, cycle, ….
      decos.push(Decoration.widget(pos + 1, () => underHeading(id, t, notes), { side: -1, key: `docnote-${t}-${id}-${sigOf(notes)}` }));
    } else if (t === "snippet") {
      // A snippet has no header, so its note reads ABOVE the bubble (like the scene).
      decos.push(Decoration.widget(pos, () => underHeading(id, "snippet", notes), { side: -1, key: `docnote-snip-${id}-${sigOf(notes)}` }));
    } else {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "has-note", "data-tip": tooltipOf(notes) }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export function docNotesPlugin(): Plugin<DocNoteState> {
  return new Plugin<DocNoteState>({
    key,
    state: {
      init: () => ({ map: {}, deco: DecorationSet.empty }),
      apply: (tr, value) => {
        const meta = tr.getMeta(key) as DocNoteMap | undefined;
        if (meta) return { map: meta, deco: computeNoteDecos(tr.doc, meta) };
        if (tr.docChanged) return { map: value.map, deco: computeNoteDecos(tr.doc, value.map) };
        return value; // pure caret / selection move -> reuse the cached set
      },
    },
    props: { decorations: (state) => key.getState(state)?.deco ?? null },
    // A GUTTER OVERLAY (a sibling of the doc on the scroll container, escaping the bubble/block paint
    // containment) holds the note chips, level with each node, to the RIGHT of the script column. Only
    // BEATS get a chip - scene / block / snippet / group show their notes as reading-layer text (decorations
    // above the item), so they're skipped here (but still descended into, to reach beats nested in them).
    view(editorView) {
      return createGutterOverlay(editorView, {
        className: "note-gutter",
        gap: GUTTER_GAP,
        active: (view) => notesEnabled() && Object.keys(key.getState(view.state)?.map ?? {}).length > 0,
        paint: ({ view, topOf, add }) => {
          const map = key.getState(view.state)?.map ?? {};
          view.state.doc.descendants((node, pos) => {
            const t = node.type.name;
            if (t === "block" || t === "snippet" || t === "group") return; // these read above the item, not in the gutter
            const id = modelIdOf(node);
            if (!id) return;
            const notes = map[id];
            if (!notes?.length) return;
            const dom = view.nodeDOM(pos);
            if (!(dom instanceof HTMLElement)) return;
            const top = topOf(dom);
            if (top == null) return; // off-screen
            add(noteIcon(id, node.type.name, notes), top);
          });
        },
      });
    },
  });
}

/** Replace the visible documentation notes (a meta-only transaction - no doc change, no dirty). */
export function setDocNotes(view: EditorView, map: DocNoteMap): void {
  view.dispatch(view.state.tr.setMeta(key, map));
}
