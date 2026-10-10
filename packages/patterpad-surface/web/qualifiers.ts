// The speaker-qualifier plugin (design/proposals/speaker-qualifiers.md §3). Two jobs:
//
//   - the cue's `(O.S.)`: a node decoration on each qualified line's cue carries the qualifier's NAME
//     (the host pushes the project's list, gameId -> name), and the cue's node view draws it after the
//     name token as chrome (web/views.ts), so typing and picking a name work exactly as before;
//   - run inheritance: every transaction that adds a line, or names a blank one, gets the inherited
//     qualifier appended in the same undo step (src/qualifier.ts holds the rule).
//
// A line whose qualifier is not in the list (one removed from the project) still shows its gameId,
// marked, so the writer sees what validation is complaining about.

import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { inheritQualifiers, qualifierOf } from "../src/qualifier.js";
import { BEAT_TYPES, editsInsideTextblocks } from "../src/zoneutil.js";

/** One of the project's qualifiers as the surface needs it: the gameId a line stores, and the name the
 *  cue shows. */
export interface QualifierChoice { gameId: string; name: string }

interface QualifierState {
  list: QualifierChoice[];
  names: Map<string, string>;
  decos: DecorationSet;
}

/** What a cue decoration's spec carries for the node view. */
export interface CueQualifierSpec { qualifier: string; unknown: boolean }

export const qualifierKey = new PluginKey<QualifierState>("patterQualifiers");
const SET_LIST = "patterQualifierList";

/** One node decoration per qualified line, on its cue. */
function build(doc: PMNode, names: Map<string, string>): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!BEAT_TYPES.has(node.type.name)) return true;
    if (node.type.name !== "line") return false;
    const q = qualifierOf(node);
    const cue = node.firstChild;
    if (q && cue?.type.name === "cue") {
      const name = names.get(q);
      const spec: CueQualifierSpec = { qualifier: name ?? q, unknown: name === undefined };
      decos.push(Decoration.node(pos + 1, pos + 1 + cue.nodeSize, { "data-qualifier": q }, spec));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const namesOf = (list: QualifierChoice[]): Map<string, string> => new Map(list.map((q) => [q.gameId, q.name]));

export function qualifiersPlugin(initial: QualifierChoice[] = []): Plugin<QualifierState> {
  return new Plugin<QualifierState>({
    key: qualifierKey,
    state: {
      init: (_config, state) => { const names = namesOf(initial); return { list: initial, names, decos: build(state.doc, names) }; },
      apply: (tr, prev, _old, state) => {
        const list = tr.getMeta(SET_LIST) as QualifierChoice[] | undefined;
        if (list) { const names = namesOf(list); return { list, names, decos: build(state.doc, names) }; }
        if (!tr.docChanged) return prev;
        // Typing moves no line and changes no qualifier: map. Anything structural (or an attribute
        // change, which is how a qualifier is set) rebuilds.
        if (editsInsideTextblocks(tr)) return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };
        return { ...prev, decos: build(state.doc, prev.names) };
      },
    },
    props: { decorations: (state) => qualifierKey.getState(state)?.decos },
    appendTransaction: (trs, oldState, newState) => inheritQualifiers(trs, oldState, newState),
  });
}

/** A transaction that hands the plugin the project's qualifier list (in display order). */
export function setQualifierList(state: EditorState, list: QualifierChoice[]): Transaction {
  return state.tr.setMeta(SET_LIST, list.map((q) => ({ gameId: q.gameId, name: q.name })));
}

/** The project's qualifier list as the plugin last heard it. */
export function qualifierList(state: EditorState): QualifierChoice[] {
  return qualifierKey.getState(state)?.list ?? [];
}
