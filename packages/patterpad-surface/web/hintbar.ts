// The contextual hint bar (spec section 16), for the harness. A live render of
// hintsFor(context(state)) - the same ZoneState the key-dispatch reads - so it
// shows the 2-4 relevant transitions for wherever the cursor is. Grows as the
// zone slices add states.
//
// The chips are the shell's (`hintBar`, keys.css): a keycap drawn platform-true
// from the hint's portable combo ("Shift+Enter" is one "⇧↩" cap on a Mac and
// "Shift" "Enter" side by side elsewhere), a label, and nothing typed between
// items. A hint whose affordance is a control rather than a key carries a drawn
// icon in place of the legend.

import type { EditorView } from "prosemirror-view";
import { context, type ZoneState } from "../src/context.js";
import { hintsFor, multiSelectHints } from "../src/hints.js";
import { hintBar, iconNode } from "@wildwinter/app-shell";

// `ctx` is optional so the dispatch loop can pass the ZoneState it already computed for the
// transaction (it is otherwise re-derived here); falls back to computing it for standalone calls.
export function createHintBar(el: HTMLElement): (view: EditorView, ctx?: ZoneState) => void {
  return (view: EditorView, ctx: ZoneState = context(view.state)): void => {
    el.replaceChildren();
    // No hints when the cursor isn't placed anywhere: an unfocused editor has a stale selection but no
    // live insertion point, so the bar would otherwise show hints for a caret the user can't see.
    if (!view.hasFocus()) return;
    // A multi-chunk run has no single caret context - show what the SELECTION can do instead (§6).
    const hints = multiSelectHints(view.state) ?? hintsFor(ctx);
    if (!hints.length) return;
    const bar = hintBar(hints.map((h) => ({ keys: h.icon ? "" : h.key, label: h.label })));
    // An icon hint asked for an empty keycap above; draw the icon into it.
    hints.forEach((h, i) => { if (h.icon) bar.children[i]?.querySelector("kbd")?.replaceChildren(iconNode(h.icon, 10)); });
    el.append(bar);
  };
}
