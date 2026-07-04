// ---------------------------------------------------------------------------
// Phase C: reordering chunks among their siblings (groups §6) - the keyboard-free
// move up / down (drag-and-drop's fast path layers onto the same command later).
// Works for bubbles and groups; a no-op at the container's edge; nested too.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { moveChunk } from "../src/groups.js";

const line = (id: string) => ({ id, type: "snippet" as const, beats: [{ id: `${id}_L`, kind: "line" as const }] });

function stateOf(children: Scene["blocks"][0]["children"]): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] };
  return EditorState.create({ doc: sceneToDoc(scene, {}) });
}
/** Position of the nth direct child chunk of the (only) block. */
function chunkPos(s: EditorState, n: number): number {
  const out: number[] = [];
  s.doc.descendants((node, pos) => {
    if (node.type.name === "block") { node.forEach((c, off) => out.push(pos + 1 + off)); return false; }
    return true;
  });
  return out[n]!;
}
const ids = (s: EditorState) => docToScene(s.doc).scene.blocks[0]!.children.map((c) => c.id);

describe("moveChunk", () => {
  it("moves a bubble down past its next sibling", () => {
    const s = stateOf([line("a"), line("b"), line("c")]);
    const out = s.apply(moveChunk(s, chunkPos(s, 0), "down")!);
    expect(ids(out)).toEqual(["b", "a", "c"]);
  });

  it("moves a bubble up past its previous sibling", () => {
    const s = stateOf([line("a"), line("b"), line("c")]);
    const out = s.apply(moveChunk(s, chunkPos(s, 2), "up")!);
    expect(ids(out)).toEqual(["a", "c", "b"]);
  });

  it("reorders a group the same way", () => {
    const s = stateOf([line("a"), { id: "g", type: "group", selector: "choice", children: [line("x")] }, line("c")]);
    const out = s.apply(moveChunk(s, chunkPos(s, 1), "up")!);
    expect(ids(out)).toEqual(["g", "a", "c"]);
  });

  it("is a no-op at the container's edge (returns null)", () => {
    const s = stateOf([line("a"), line("b")]);
    expect(moveChunk(s, chunkPos(s, 0), "up")).toBeNull();    // already first
    expect(moveChunk(s, chunkPos(s, 1), "down")).toBeNull();  // already last
  });

  it("reorders within a nested group, leaving siblings outside untouched", () => {
    const s = stateOf([{ id: "g", type: "group", selector: "sequence", children: [line("x"), line("y"), line("z")] }]);
    // move "z" (index 2 inside the group) up -> x, z, y
    let pos = -1;
    s.doc.descendants((n) => { if (pos < 0 && n.type.name === "group") return true; return true; });
    s.doc.descendants((node, p) => { if (node.type.name === "snippet") { const raw = JSON.parse(node.attrs.raw); if (raw.id === "z") pos = p; } return true; });
    const out = s.apply(moveChunk(s, pos, "up")!);
    const g = docToScene(out.doc).scene.blocks[0]!.children[0] as { children: { id: string }[] };
    expect(g.children.map((c) => c.id)).toEqual(["x", "z", "y"]);
  });
});
