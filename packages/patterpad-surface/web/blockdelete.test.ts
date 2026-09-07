// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Two surface fixes: (1) deleting a whole BLOCK (the block heading's menu), and
// (2) sweeping wholly-empty unfinished line beats out of the doc on blur.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { deleteBlock } from "../src/groups.js";
import { sweepEmptyBeats } from "./surface.js";

const blockPos = (state: EditorState, name: string): number => {
  let p = -1;
  state.doc.descendants((node, pos) => {
    if (p < 0 && node.type.name === "block") { try { if (JSON.parse(node.attrs.raw).name === name) p = pos; } catch { /* skip */ } }
    return false; // blocks are top-level
  });
  return p;
};
const blockNames = (state: EditorState) => docToScene(state.doc).scene.blocks.map((b) => b.name);

describe("deleteBlock", () => {
  const twoBlocks: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "One", children: [{ id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }] }] },
    { id: "b2", type: "block", name: "Two", children: [{ id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "B" }] }] },
  ] };

  it("removes the block and everything in it", () => {
    const s0 = EditorState.create({ doc: sceneToDoc(twoBlocks, { L1: "hi", L2: "bye" }) });
    const s = s0.apply(deleteBlock(s0, blockPos(s0, "Two"))!);
    expect(blockNames(s)).toEqual(["One"]);
  });

  it("refuses to delete the scene's only block (the doc must keep one)", () => {
    const one: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "Only", children: [{ id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }] }] },
    ] };
    const s0 = EditorState.create({ doc: sceneToDoc(one, { L1: "hi" }) });
    expect(deleteBlock(s0, blockPos(s0, "Only"))).toBeNull();
  });
});

describe("sweepEmptyBeats", () => {
  const beatsOf = (state: EditorState) => {
    const out: string[][] = [];
    docToScene(state.doc).scene.blocks[0]!.children.forEach((c) => {
      const snip = c as { beats?: Array<{ id: string }> };
      out.push((snip.beats ?? []).map((b) => b.id));
    });
    return out;
  };

  it("removes a wholly-empty unfinished line but keeps written + named lines", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] }, // written
        { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line" }] },                    // empty, no character -> swept
        { id: "sn3", type: "snippet", beats: [{ id: "L3", kind: "line", character: "BO" }] },    // a named-but-unsaid line stays
      ] },
    ] };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, { L1: "hello", L2: "", L3: "" }) });
    const tr = sweepEmptyBeats(s0);
    expect(tr).not.toBeNull();
    const s = s0.apply(tr!);
    expect(beatsOf(s)).toEqual([["L1"], [], ["L3"]]); // sn2's empty line gone; bubble left as a ghost
  });

  it("leaves the caret ON the bubble it swept, not in a neighbouring one (#63)", () => {
    // The caret sits in sn2's blank line, which is sn2's only beat. Deleting it leaves the selection
    // homeless, and PM's own mapping lands it in the nearest text - a beat in sn1 or sn3 - which is how
    // the inspector ended up pointing at a snippet the author had never chosen.
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
        { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line" }] },
        { id: "sn3", type: "snippet", beats: [{ id: "L3", kind: "line", character: "BO" }] },
      ] },
    ] };
    const doc = sceneToDoc(scene, { L1: "hello", L2: "", L3: "later" });
    let blankPos = -1;
    doc.descendants((n, pos) => { if (blankPos < 0 && n.type.name === "line" && n.textContent === "" && !n.textBetween(0, n.content.size)) blankPos = pos; return blankPos < 0; });
    const s0 = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(blankPos + 2)) });
    const s = s0.apply(sweepEmptyBeats(s0)!);
    expect(s.selection).toBeInstanceOf(NodeSelection);
    expect((s.selection as NodeSelection).node.type.name).toBe("snippet");
    // ...and it is sn2 (now beat-less), not the bubble before or after it.
    expect(docToScene(s.doc).scene.blocks[0]!.children[1]!.id).toBe("sn2");
    expect((s.selection as NodeSelection).node.childCount).toBe(0);
  });

  it("is a no-op when every line has content", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
      ] },
    ] };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, { L1: "hello" }) });
    expect(sweepEmptyBeats(s0)).toBeNull();
  });
});
