// ---------------------------------------------------------------------------
// Phase C2: the group affordances (groups §7) - UNWRAP keeps the content (splice
// children up into the parent), DELETE removes the group AND its content, never
// emptying a block. Pure commands; the UI confirms the destructive one.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { unwrapGroup, deleteChunk, seedSnippet, chunkIsEmpty } from "../src/groups.js";

const line = (id: string) => ({ id, type: "snippet" as const, beats: [{ id: `${id}_L`, kind: "line" as const }] });

function stateOf(children: Scene["blocks"][0]["children"]): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] };
  return EditorState.create({ doc: sceneToDoc(scene, {}) });
}
function firstGroupPos(s: EditorState): number {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "group") p = pos; });
  return p;
}
const childIds = (s: EditorState) => docToScene(s.doc).scene.blocks[0]!.children.map((c) => c.id);

describe("unwrapGroup - keep the content", () => {
  it("dissolves the group, splicing its children into the parent in place", () => {
    const s = stateOf([
      line("a"),
      { id: "g", type: "group", selector: "sequence", children: [line("x"), line("y")] },
      line("b"),
    ]);
    const tr = unwrapGroup(s, firstGroupPos(s))!;
    const out = s.apply(tr);
    expect(childIds(out)).toEqual(["a", "x", "y", "b"]); // group gone, content survives, order kept
  });
});

describe("deleteChunk - take the content with it", () => {
  it("removes the group and its content when it is not the block's only child", () => {
    const s = stateOf([line("a"), { id: "g", type: "group", selector: "choice", children: [line("x")] }]);
    const out = s.apply(deleteChunk(s, firstGroupPos(s))!);
    expect(childIds(out)).toEqual(["a"]); // group + its content gone
  });

  it("leaves the block EMPTY when deleting its sole-child group (D1: a ghost shows, no re-seed)", () => {
    const s = stateOf([{ id: "g", type: "group", selector: "choice", children: [line("x")] }]);
    const out = s.apply(deleteChunk(s, firstGroupPos(s))!);
    const kids = docToScene(out.doc).scene.blocks[0]!.children;
    expect(kids).toEqual([]); // block is genuinely empty (chunk*); the surface renders a ghost
  });

  it("deletes a SNIPPET, leaving an empty container when it was the only child (D1: no re-seed)", () => {
    const snipPos = (s: EditorState, id: string): number => {
      let p = -1; s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && (JSON.parse(n.attrs.raw).id ?? null) === id) { p = pos; return false; } return true; }); return p;
    };
    // among siblings: just removed
    const s1 = stateOf([line("a"), line("b")]);
    expect(childIds(s1.apply(deleteChunk(s1, snipPos(s1, "a"))!))).toEqual(["b"]);
    // sole child of a GROUP: the group is left empty (the ghost-snippet placeholder shows)
    const s2 = stateOf([{ id: "g", type: "group", selector: "sequence", children: [line("x")] }]);
    const out = s2.apply(deleteChunk(s2, snipPos(s2, "x"))!);
    const group = docToScene(out.doc).scene.blocks[0]!.children[0] as { id: string; children: unknown[] };
    expect(group.id).toBe("g");
    expect(group.children).toEqual([]); // empty group, not re-seeded
  });
});

describe("seedSnippet - the ghost '+' materialises a snippet in an empty container", () => {
  it("seeds a fresh bubble in an emptied block, caret inside it", () => {
    const s0 = stateOf([line("only")]);
    const onlyPos = (() => { let p = -1; s0.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet") { p = pos; return false; } return true; }); return p; })();
    const empty = s0.apply(deleteChunk(s0, onlyPos)!);
    expect(docToScene(empty.doc).scene.blocks[0]!.children).toEqual([]); // truly empty first

    const blockPos = (() => { let p = -1; empty.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "block") { p = pos; return false; } return true; }); return p; })();
    const out = empty.apply(seedSnippet(empty, blockPos)!);
    const kids = docToScene(out.doc).scene.blocks[0]!.children as { type: string }[];
    expect(kids).toHaveLength(1);
    expect(kids[0]!.type).toBe("snippet");
  });

  it("refuses on a non-empty container (only seeds the empty ones)", () => {
    const s = stateOf([line("a")]);
    let blockPos = -1; s.doc.descendants((n, pos) => { if (blockPos < 0 && n.type.name === "block") { blockPos = pos; return false; } return true; });
    expect(seedSnippet(s, blockPos)).toBeNull();
  });
});

describe("chunkIsEmpty - the delete-confirmation skip predicate", () => {
  const firstChunk = (s: EditorState): import("prosemirror-model").Node => { let n: any; s.doc.descendants((node) => { if (!n && (node.type.name === "snippet" || node.type.name === "group")) { n = node; return false; } return true; }); return n; };

  it("a blank line snippet is empty", () => {
    expect(chunkIsEmpty(firstChunk(stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L", kind: "line" }] }])))).toBe(true);
  });
  it("a snippet with typed content is NOT empty", () => {
    const s = EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "ANNA" }] }] }] }, { L: "Hello" }) });
    expect(chunkIsEmpty(firstChunk(s))).toBe(false);
  });
  it("a pure-jump snippet is NOT empty (the jump is content)", () => {
    expect(chunkIsEmpty(firstChunk(stateOf([{ id: "sn", type: "snippet", jump: { to: "END" } }])))).toBe(false);
  });
  it("a group of only blank snippets is empty; one with content is not", () => {
    const blank = firstChunk(stateOf([{ id: "g", type: "group", selector: "sequence", children: [{ id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line" }] }, { id: "s2", type: "snippet", beats: [{ id: "L2", kind: "text" }] }] }]));
    expect(chunkIsEmpty(blank)).toBe(true);
    const withGameEvent = firstChunk(stateOf([{ id: "g", type: "group", selector: "sequence", children: [{ id: "s1", type: "snippet", beats: [{ id: "A1", kind: "gameEvent" }] }] }]));
    expect(chunkIsEmpty(withGameEvent)).toBe(false); // a game-event atom is content
  });
});
