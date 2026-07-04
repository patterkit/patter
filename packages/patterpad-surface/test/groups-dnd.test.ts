// ---------------------------------------------------------------------------
// Phase C: moveNodeTo - the engine drag-and-drop drives (groups §6). Moves a node
// to an arbitrary sibling seam: reorder within a container, OR reparent into / out
// of a group; with the guards (own-subtree, type mismatch, never-empty-a-block).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { moveNodeTo, dropUnwrapsOption, moveRangeTo, chunkContaining, rangeAcrossChunks, deleteChunksAt, wrapChunksAt, moveChunksAt } from "../src/groups.js";

const line = (id: string) => ({ id, type: "snippet" as const, beats: [{ id: `${id}_L`, kind: "line" as const }] });
const group = (id: string, children: ReturnType<typeof line>[]) => ({ id, type: "group" as const, selector: "sequence" as const, children });

function stateOf(blocks: Scene["blocks"]): EditorState {
  return EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks }, {}) });
}
/** Position before the node with model id `id`. */
function posOf(s: EditorState, id: string): number {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && (n.type.name === "snippet" || n.type.name === "group" || n.type.name === "block") && JSON.parse(n.attrs.raw).id === id) p = pos; });
  return p;
}
/** A seam: the position just BEFORE the node with id `id` (i.e. insert-before it). */
const seamBefore = (s: EditorState, id: string): number => posOf(s, id);
/** A seam just AFTER the node with id `id`. */
const seamAfter = (s: EditorState, id: string): number => { const p = posOf(s, id); return p + s.doc.nodeAt(p)!.nodeSize; };
const blockKidIds = (s: EditorState, b = 0) => docToScene(s.doc).scene.blocks[b]!.children.map((c) => c.id);

describe("moveNodeTo", () => {
  it("reorders a bubble within its block (to the front)", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("x"), line("c")] }]);
    const out = s.apply(moveNodeTo(s, posOf(s, "x"), seamBefore(s, "a"))!);
    expect(blockKidIds(out)).toEqual(["x", "a", "c"]);
  });

  it("reparents a bubble INTO a group", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), group("g", [line("x")])] }]);
    const out = s.apply(moveNodeTo(s, posOf(s, "a"), seamBefore(s, "x"))!); // before x, inside g
    expect(blockKidIds(out)).toEqual(["g"]);                                  // a left the block
    const g = docToScene(out.doc).scene.blocks[0]!.children[0] as { children: { id: string }[] };
    expect(g.children.map((c) => c.id)).toEqual(["a", "x"]);                  // ...and joined the group
  });

  it("reparents a bubble OUT of a group into the block", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [group("g", [line("x"), line("y")]), line("c")] }]);
    const out = s.apply(moveNodeTo(s, posOf(s, "x"), seamBefore(s, "c"))!); // before c, in the block
    expect(blockKidIds(out)).toEqual(["g", "x", "c"]);
  });

  it("moves a whole group, content intact", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), group("g", [line("x")]), line("c")] }]);
    const out = s.apply(moveNodeTo(s, posOf(s, "g"), seamBefore(s, "a"))!);
    expect(blockKidIds(out)).toEqual(["g", "a", "c"]);
  });

  it("moves a block among blocks", () => {
    const s = stateOf([
      { id: "b1", type: "block", name: "B1", children: [line("a")] },
      { id: "b2", type: "block", name: "B2", children: [line("b")] },
    ]);
    const out = s.apply(moveNodeTo(s, posOf(s, "b1"), seamAfter(s, "b2"))!);
    expect(docToScene(out.doc).scene.blocks.map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("leaves the source block EMPTY when a move empties it (D1: a ghost shows, no re-seed)", () => {
    const s = stateOf([
      { id: "b1", type: "block", name: "B1", children: [line("only")] },
      { id: "b2", type: "block", name: "B2", children: [line("z")] },
    ]);
    const out = s.apply(moveNodeTo(s, posOf(s, "only"), seamBefore(s, "z"))!);
    const bs = docToScene(out.doc).scene.blocks;
    expect(bs[0]!.children).toEqual([]);                // b1 is genuinely empty (chunk*); the surface renders a ghost
    expect(bs[1]!.children.map((c) => c.id)).toEqual(["only", "z"]);
  });

  it("refuses to drop a node into its own subtree, and a type-mismatched target", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [group("g", [line("x")]), line("c")] }]);
    expect(moveNodeTo(s, posOf(s, "g"), seamBefore(s, "x"))).toBeNull();   // g into its own child x
    expect(moveNodeTo(s, posOf(s, "b"), seamBefore(s, "c"))).toBeNull();   // a block into a block (chunk seam)
  });

  // --- choice-aware drops (groups §8): wrap into / unwrap out of a choice ---------
  const choice = (id: string, options: ReturnType<typeof option>[]) => ({ id, type: "group" as const, selector: "choice" as const, children: options });
  const option = (id: string, children: ReturnType<typeof line>[]) => ({ id, type: "group" as const, choiceText: id, children });
  const kids = (s: EditorState, id: string) => (docToScene(s.doc).scene.blocks[0]!.children.find((c) => c.id === id) as { children: { id: string; type: string }[] }).children;
  const findGroup = (s: EditorState, id: string) => { let r: any; const walk = (ns: any[]) => ns.forEach((n) => { if (n.id === id) r = n; if (n.children) walk(n.children); }); walk(docToScene(s.doc).scene.blocks[0]!.children); return r; };

  it("wraps a snippet dropped INTO a choice in a fresh Option", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), choice("ch", [option("o1", [line("x")])])] }]);
    const out = s.apply(moveNodeTo(s, posOf(s, "a"), seamBefore(s, "o1"))!); // before o1, inside the choice
    expect(blockKidIds(out)).toEqual(["ch"]);            // a left the block
    const opts = kids(out, "ch");
    expect(opts.map((o) => o.id)).toEqual([expect.not.stringMatching(/^a$/), "o1"]); // a is now a NEW option, before o1
    expect(opts[0]!.type).toBe("group");                 // ...an Option group
    const wrapped = findGroup(out, opts[0]!.id);
    expect(wrapped.children.map((c: { id: string }) => c.id)).toEqual(["a"]); // ...wrapping the snippet
  });

  it("unwraps an Option dragged OUT to a non-choice parent (splices its content)", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [choice("ch", [option("o1", [line("x")]), option("o2", [line("y")])]), line("c")] }]);
    expect(dropUnwrapsOption(s, posOf(s, "o1"), seamBefore(s, "c"))).toBe(true);
    const out = s.apply(moveNodeTo(s, posOf(s, "o1"), seamBefore(s, "c"))!);
    expect(blockKidIds(out)).toEqual(["ch", "x", "c"]);  // o1 dissolved; its content (x) spliced into the block
    expect(kids(out, "ch").map((o) => o.id)).toEqual(["o2"]); // the choice keeps o2
  });

  it("keeps an Option as an Option when moved into ANOTHER choice", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [choice("ch1", [option("o1", [line("x")])]), choice("ch2", [option("o2", [line("y")])])] }]);
    expect(dropUnwrapsOption(s, posOf(s, "o1"), seamBefore(s, "o2"))).toBe(false); // choice -> choice does not unwrap
    const out = s.apply(moveNodeTo(s, posOf(s, "o1"), seamBefore(s, "o2"))!);
    expect(kids(out, "ch1")).toEqual([]);                // ch1 emptied
    const ch2 = kids(out, "ch2");
    expect(ch2.map((o) => o.id)).toEqual(["o1", "o2"]);  // o1 joined ch2, still an Option
    expect(ch2.every((o) => o.type === "group")).toBe(true);
  });

  it("dropUnwrapsOption is false for a plain snippet move", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("b2")] }]);
    expect(dropUnwrapsOption(s, posOf(s, "a"), seamBefore(s, "b2"))).toBe(false);
  });

  it("a reparent round-trips losslessly", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), group("g", [line("x")])] }]);
    const out = s.apply(moveNodeTo(s, posOf(s, "a"), seamBefore(s, "x"))!);
    const sc = docToScene(out.doc);
    expect(docToScene(sceneToDoc(sc.scene, sc.strings)).scene).toEqual(sc.scene);
  });
});

// --- multi-select: contiguous range helpers + run move (groups §6) -----------
describe("contiguous chunk range (shift-click multi-select)", () => {
  /** The node span [start, end) covering the run of sibling chunks first..last. */
  const runSpan = (s: EditorState, firstId: string, lastId: string): { start: number; end: number } => {
    const start = posOf(s, firstId);
    const lp = posOf(s, lastId);
    return { start, end: lp + s.doc.nodeAt(lp)!.nodeSize };
  };

  it("chunkContaining finds the chunk a position sits inside; rangeAcrossChunks spans siblings", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("b2"), line("c")] }]);
    const inB2 = posOf(s, "b2") + 2; // a caret inside b2
    expect(chunkContaining(s.doc, inB2)).toBe(posOf(s, "b2"));
    const sel = rangeAcrossChunks(s.doc, posOf(s, "a"), posOf(s, "c"));
    expect(sel).not.toBeNull();
    // the selection's blockRange covers all three sibling chunks
    const range = sel!.$from.blockRange(sel!.$to, (p) => p.type.name === "block");
    expect(range!.endIndex - range!.startIndex).toBe(3);
  });

  it("rangeAcrossChunks refuses non-siblings (different containers)", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), group("g", [line("x")])] }]);
    expect(rangeAcrossChunks(s.doc, posOf(s, "a"), posOf(s, "x"))).toBeNull(); // a is in the block, x inside g
  });

  it("moveRangeTo reorders the whole run within its block", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("b2"), line("c"), line("d")] }]);
    const run = runSpan(s, "b2", "c");
    const out = s.apply(moveRangeTo(s, run.start, run.end, seamAfter(s, "d"))!);
    expect(blockKidIds(out)).toEqual(["a", "d", "b2", "c"]); // b2,c moved together after d
  });

  it("moveRangeTo reparents the run into a group, keeping order", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("b2"), group("g", [line("x")])] }]);
    const run = runSpan(s, "a", "b2");
    const out = s.apply(moveRangeTo(s, run.start, run.end, seamBefore(s, "x"))!);
    expect(blockKidIds(out)).toEqual(["g"]);                 // a,b2 left the block
    const g = docToScene(out.doc).scene.blocks[0]!.children[0] as { children: { id: string }[] };
    expect(g.children.map((c) => c.id)).toEqual(["a", "b2", "x"]);
  });

  it("moveRangeTo refuses a drop inside its own span", () => {
    const s = stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("b2"), line("c")] }]);
    const run = runSpan(s, "a", "c");
    expect(moveRangeTo(s, run.start, run.end, seamBefore(s, "b2"))).toBeNull(); // a seam between a and c is inside the run
  });
});

// --- by-position set commands: act on a DISCONTIGUOUS set [a, c] (groups §6) -------------------
describe("discontiguous chunk-set commands (gather)", () => {
  const four = (): EditorState => stateOf([{ id: "b", type: "block", name: "B", children: [line("a"), line("b2"), line("c"), line("d")] }]);

  it("deleteChunksAt removes exactly the set, leaving the gaps", () => {
    const s = four();
    const out = s.apply(deleteChunksAt(s, [posOf(s, "a"), posOf(s, "c")])!);
    expect(blockKidIds(out)).toEqual(["b2", "d"]); // a and c gone; b2, d stay
  });

  it("wrapChunksAt gathers the set into a group at the lowest position; the gap stays behind", () => {
    const s = four();
    const out = s.apply(wrapChunksAt(s, [posOf(s, "a"), posOf(s, "c")], "sequence")!);
    const ids = docToScene(out.doc).scene.blocks[0]!.children.map((c) => c.id);
    expect(ids[1]).toBe("b2"); expect(ids[2]).toBe("d");          // b2, d remain after the group
    const grp = docToScene(out.doc).scene.blocks[0]!.children[0] as { type: string; children: { id: string }[] };
    expect(grp.type).toBe("group");
    expect(grp.children.map((c) => c.id)).toEqual(["a", "c"]);    // a, c gathered (in order), 3 left behind
  });

  it("moveChunksAt moves the whole set together to a seam", () => {
    const s = four();
    const out = s.apply(moveChunksAt(s, [posOf(s, "a"), posOf(s, "c")], seamAfter(s, "d"))!);
    expect(blockKidIds(out)).toEqual(["b2", "d", "a", "c"]); // a,c gathered after d
  });
});
