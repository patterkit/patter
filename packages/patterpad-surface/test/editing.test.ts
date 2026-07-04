// ---------------------------------------------------------------------------
// Z9: selection-delete guard (no removing atoms via selection - spec §13.1/§15)
// and structural undo via prosemirror-history.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { canonicalStringify } from "@patterkit/core";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { deleteSelectionGuarded } from "../src/delete.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "M", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA" },
        { id: "A1", kind: "gameEvent" },
        { id: "L2", kind: "line", character: "BO" },
      ] },
    ] },
  ],
};
const strings = { L1: "Hello", L2: "World" };

const sayStart = (doc: ReturnType<typeof sceneToDoc>, id: string): number => {
  let p = -1;
  doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if (node.type.name === "line" && node.attrs.id === id) { node.forEach((z, o) => { if (z.type.name === "say") p = pos + 1 + o + 1; }); return false; }
    return true;
  });
  return p;
};

describe("deleteSelectionGuarded", () => {
  it("deletes a plain text range", () => {
    const doc = sceneToDoc(scene, strings);
    const from = sayStart(doc, "L1") + 1, to = sayStart(doc, "L1") + 3; // "el" of "Hello"
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
    let next = state;
    deleteSelectionGuarded(state, (tr) => { next = state.apply(tr); });
    expect(docToScene(next.doc).strings.L1).toBe("Hlo");
  });

  it("refuses a range that would remove a game-event atom", () => {
    const doc = sceneToDoc(scene, strings);
    const from = sayStart(doc, "L1"), to = sayStart(doc, "L2") + 5; // spans the game-event A1
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
    const before = canonicalStringify(docToScene(state.doc).scene);
    let changed = false;
    deleteSelectionGuarded(state, () => { changed = true; });
    expect(changed).toBe(false); // refused (no dispatch)
  });
});

describe("structural undo (prosemirror-history)", () => {
  it("undoes an edit back to the original bytes", () => {
    const doc = sceneToDoc(scene, strings);
    const base = EditorState.create({ doc, plugins: [history()] });
    const edited = base.apply(base.tr.insertText("!", sayStart(doc, "L1") + 5));
    expect(docToScene(edited.doc).strings.L1).toBe("Hello!");

    let undone = edited;
    undo(edited, (tr) => { undone = edited.apply(tr); });
    expect(docToScene(undone.doc).strings.L1).toBe("Hello");
    expect(canonicalStringify(docToScene(undone.doc).scene)).toBe(canonicalStringify(scene));
  });
});
