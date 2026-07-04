// ---------------------------------------------------------------------------
// Inline validation squiggle (Patterpad.md §4): a ProseMirror plugin that draws a
// gentle wavy underline / left-accent on the nodes a validation problem points at
// (by model id). Decorations (not manual classes) so the marks survive editing
// re-renders. The host pushes the current problem set via setProblemMarks; the
// plugin maps ids -> node positions each render and decorates them.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { modelIdOf } from "../src/zoneutil.js";

export interface ProblemMark { id: string; severity: "error" | "warning" }

// The marks PLUS the computed decoration set: caching the set in plugin state (recomputed only on a marks
// push or a doc edit) means PM's per-update `decorations` prop is a cheap lookup, NOT a full-doc walk on
// every caret move. Mirrors spellcheck.ts.
interface ProblemState { marks: ProblemMark[]; deco: DecorationSet }
const key = new PluginKey<ProblemState>("patterProblems");

/** Walk the doc once, decorating every node a problem points at (by model id). */
function computeProblemDecos(doc: PMNode, marks: ProblemMark[]): DecorationSet {
  if (!marks.length) return DecorationSet.empty;
  const sev = new Map(marks.map((m) => [m.id, m.severity]));
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    const id = modelIdOf(node);
    if (id && sev.has(id)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `has-problem problem-${sev.get(id)}` }));
  });
  return DecorationSet.create(doc, decos);
}

export function problemsPlugin(): Plugin<ProblemState> {
  return new Plugin<ProblemState>({
    key,
    state: {
      init: () => ({ marks: [], deco: DecorationSet.empty }),
      apply: (tr, value) => {
        const meta = tr.getMeta(key) as ProblemMark[] | undefined;
        if (meta) return { marks: meta, deco: computeProblemDecos(tr.doc, meta) };
        if (tr.docChanged) return { marks: value.marks, deco: computeProblemDecos(tr.doc, value.marks) };
        return value; // pure caret / selection move -> reuse the cached set
      },
    },
    props: { decorations: (state) => key.getState(state)?.deco ?? null },
  });
}

/** Replace the inline problem marks (a meta-only transaction - no doc change, no dirty). */
export function setProblemMarks(view: EditorView, marks: ProblemMark[]): void {
  view.dispatch(view.state.tr.setMeta(key, marks));
}
