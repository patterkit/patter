// @vitest-environment jsdom
// Verify the real harness flow: Enter mirrors a dialogue line (name selected,
// popup open); Space flips it to free text, drops the speaker, and closes popup.
import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { enter } from "../src/lines.js";
import { flipToFreeText } from "../src/linetype.js";
import { context } from "../src/context.js";
import { nodeViews } from "./views.js";
import { createCuePopup } from "./cuepopup.js";

describe("Enter-mirror then Space (full harness handlers)", () => {
  it("flips to free text, removes the name, and closes the popup", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] }] },
    ] };
    const doc = sceneToDoc(scene, { L1: "Hi" });
    let sayEnd = 0;
    doc.descendants((n, p) => { if (n.type.name === "say") { sayEnd = p + 1 + n.content.size; return false; } return true; });

    const host = document.createElement("div"); document.body.appendChild(host);
    const popup = createCuePopup(() => ["ANNA", "BO"]);
    const view = new EditorView(host, {
      state: EditorState.create({ doc, selection: TextSelection.create(doc, sayEnd) }),
      nodeViews,
      handleTextInput: (v, _f, _t, text) => popup.handleTextInput(v, text),
      handleKeyDown: (v, event) => {
        if (popup.handleKeyDown(v, event)) return true;
        // Space on KEYDOWN (typing over a selection bypasses handleTextInput).
        if (event.key === " ") { const tr = flipToFreeText(v.state); if (tr) { v.dispatch(tr); popup.close(); return true; } }
        return false;
      },
      handleScrollToSelection: () => true, // jsdom can't measure coords; skip scroll-into-view
      dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); popup.update(view); },
    });
    view.focus(); // the popup only opens for a focused editor

    enter(view.state, view.dispatch);            // mirror -> name selected, cue
    popup.update(view);                          // popup opens
    expect(context(view.state).zone?.role).toBe("cue");
    expect(view.state.selection.empty).toBe(false);    // name selected
    expect(popup.isOpen()).toBe(true);

    const handled = view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key: " " })));
    expect(handled).toBe(true);

    const beat = (docToScene(view.state.doc).scene.blocks[0]!.children[0] as { beats: Array<{ kind: string; character?: string }> }).beats[1]!;
    expect(beat.kind).toBe("text");              // switched to a text line
    expect(beat.character).toBeUndefined();      // name removed
    expect(popup.isOpen()).toBe(false);          // popup closed
    view.destroy();
  });
});
