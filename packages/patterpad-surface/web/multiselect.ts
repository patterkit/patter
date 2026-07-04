// Multi-chunk selection visuals (groups §6): paint each chunk in the selection SET (held in the
// src/multiselect state plugin) with a `.chunk-multiselected` node decoration, so a run - or a
// Cmd-click set like [1,2,4] - reads as one selected block rather than a ragged text highlight. The
// set drives delete / wrap / drag / inspector / hints; this plugin is purely the visual.

import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { multiSelectPositions } from "../src/multiselect.js";

export function multiSelectDecorations(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const positions = multiSelectPositions(state);
        if (positions.length < 2) return null;
        const decos: Decoration[] = [];
        for (const pos of positions) {
          const node = state.doc.nodeAt(pos);
          if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "chunk-multiselected" }));
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
