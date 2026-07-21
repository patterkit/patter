// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The block heading (#23). Selecting a block must not turn it into a native drag
// source: ProseMirror's default selectNode sets `draggable = true` on any node view
// with a contentDOM, and because clicking the title node-SELECTS the block, that made
// dragging inside the title drag the whole block instead of selecting the text.
// A block is reordered with its ⠿ grip (a mousedown gesture, not native DnD), so the
// block element itself must never carry the flag. Driven through a real EditorView.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { nodeViews } from "./views.js";

function mount(): { view: EditorView; blockEl: HTMLElement; blockPos: number } {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "A section with a long name", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
      ] },
    ],
  };
  const doc = sceneToDoc(scene, { L1: "Hello" });
  const host = document.createElement("div"); document.body.appendChild(host);
  const view = new EditorView(host, { state: EditorState.create({ doc }), nodeViews });
  let blockPos = -1;
  view.state.doc.descendants((n, p) => { if (blockPos < 0 && n.type.name === "block") { blockPos = p; return false; } return true; });
  const blockEl = view.nodeDOM(blockPos) as HTMLElement;
  return { view, blockEl, blockPos };
}

const selectBlock = (view: EditorView, pos: number): void =>
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));

describe("block heading", () => {
  it("a node-selected block is NOT a native drag source, so its title stays selectable (#23)", () => {
    const { view, blockEl, blockPos } = mount();
    expect(blockEl.draggable).toBe(false);      // not draggable to begin with

    selectBlock(view, blockPos);                // exactly what clicking the title does (focus -> selectBlock)
    expect(blockEl.draggable).toBe(false);      // ...and STILL not, after selection
    expect(blockEl.getAttribute("draggable")).not.toBe("true");
    expect(blockEl.classList.contains("ProseMirror-selectednode")).toBe(true); // the visual state is kept

    view.destroy();
  });

  it("deselecting clears the selected class again", () => {
    const { view, blockEl, blockPos } = mount();
    selectBlock(view, blockPos);
    expect(blockEl.classList.contains("ProseMirror-selectednode")).toBe(true);

    // Move the selection off the block (onto the whole doc) - the class comes off.
    view.dispatch(view.state.tr.setSelection(NodeSelection.near(view.state.doc.resolve(blockPos + 2))));
    expect(blockEl.classList.contains("ProseMirror-selectednode")).toBe(false);

    view.destroy();
  });

  it("keeps the rename field able to grow across the heading (it is not fixed-width)", () => {
    const { view, blockEl } = mount();
    const name = blockEl.querySelector<HTMLInputElement>(".block-name")!;
    expect(name).toBeTruthy();
    expect(name.value).toBe("A section with a long name"); // the full name is in the field, not truncated
    expect(name.hasAttribute("size")).toBe(false);         // no fixed character width pinning it narrow
    view.destroy();
  });
});
