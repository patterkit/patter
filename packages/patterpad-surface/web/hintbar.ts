// The contextual hint bar (spec section 16), for the harness. A live render of
// hintsFor(context(state)) - the same ZoneState the key-dispatch reads - so it
// shows the 2-4 relevant transitions for wherever the cursor is. Grows as the
// zone slices add states.

import type { EditorView } from "prosemirror-view";
import { context, type ZoneState } from "../src/context.js";
import { hintsFor, multiSelectHints } from "../src/hints.js";

// `ctx` is optional so the dispatch loop can pass the ZoneState it already computed for the
// transaction (it is otherwise re-derived here); falls back to computing it for standalone calls.
export function createHintBar(el: HTMLElement): (view: EditorView, ctx?: ZoneState) => void {
  return (view: EditorView, ctx: ZoneState = context(view.state)): void => {
    el.replaceChildren();
    // No hints when the cursor isn't placed anywhere: an unfocused editor has a stale selection but no
    // live insertion point, so the bar would otherwise show hints for a caret the user can't see.
    if (!view.hasFocus()) return;
    // A multi-chunk run has no single caret context - show what the SELECTION can do instead (§6).
    for (const hint of multiSelectHints(view.state) ?? hintsFor(ctx)) {
      const chip = document.createElement("span"); chip.className = "hint";
      const key = document.createElement("kbd"); key.textContent = hint.key;
      const label = document.createElement("span"); label.className = "hint-label"; label.textContent = hint.label;
      chip.append(key, label);
      el.appendChild(chip);
    }
  };
}
