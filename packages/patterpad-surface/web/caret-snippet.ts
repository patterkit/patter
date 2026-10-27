// The snippet the caret is in, marked (the October 2026 UI review, step 6). On the page a snippet has no card,
// only the rule beside it, and the one you're writing in takes the accent. CSS can't find it: the focused
// element is the whole editor, never the snippet, so `:focus-within` on a snippet never matches. This paints
// a `.has-caret` node decoration on the innermost snippet holding the selection's head, and none while a
// whole node is selected (the selection's own look says which).

import { NodeSelection, Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export function caretSnippet(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        if (state.selection instanceof NodeSelection) return null;
        const $head = state.selection.$head;
        for (let d = $head.depth; d > 0; d--) {
          if ($head.node(d).type.name !== "snippet") continue;
          const pos = $head.before(d);
          return DecorationSet.create(state.doc, [Decoration.node(pos, pos + $head.node(d).nodeSize, { class: "has-caret" })]);
        }
        return null;
      },
    },
  });
}
