// ---------------------------------------------------------------------------
// Phase C: WRAP (groups §5) - take the contiguous sibling chunks the selection
// spans and wrap them in a new group. For `choice` each chunk becomes its own
// Option group; otherwise the chunks become the group's children directly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene, Group } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { wrapInGroup, wrapChunk, setSnippetCondition, canWrap } from "../src/groups.js";

const line = (id: string) => ({ id, type: "snippet" as const, beats: [{ id: `${id}_L`, kind: "line" as const }] });

function stateOf(children: Scene["blocks"][0]["children"]): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] };
  return EditorState.create({ doc: sceneToDoc(scene, {}) });
}
/** A selection spanning from inside the chunk at `i` to inside the chunk at `j` (block children). */
function selectChunks(s: EditorState, i: number, j: number): EditorState {
  const says: number[] = [];
  s.doc.descendants((n, pos) => { if (n.type.name === "say") says.push(pos + 1); return n.type.name !== "say"; });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, says[i]!, says[j]!)));
}
const blockKids = (s: EditorState) => docToScene(s.doc).scene.blocks[0]!.children;

describe("canWrap", () => {
  it("is true for a selection spanning >= 2 chunks, false for a caret / single chunk", () => {
    const s = stateOf([line("a"), line("b"), line("c")]);
    expect(canWrap(selectChunks(s, 0, 2))).toBe(true);   // a..c
    expect(canWrap(selectChunks(s, 1, 1))).toBe(false);  // within one chunk
  });
});

describe("wrapInGroup", () => {
  it("wraps the spanned bubbles in a sequence group, content preserved in order", () => {
    const s = selectChunks(stateOf([line("a"), line("b"), line("c"), line("d")]), 1, 2); // b..c
    const out = s.apply(wrapInGroup(s, "shuffle")!);
    const kids = blockKids(out);
    expect(kids.map((c) => c.id.startsWith("g") ? "group" : c.id)).toEqual(["a", "group", "d"]);
    const g = kids[1] as Group;
    expect(g.selector).toBe("sequence");
    expect(g.options).toEqual({ order: "shuffle", exhaust: "repeat" });
    expect(g.children.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("wrapping in a choice makes each chunk its own Option group", () => {
    const s = selectChunks(stateOf([line("a"), line("b")]), 0, 1); // a..b
    const out = s.apply(wrapInGroup(s, "choice")!);
    const kids = blockKids(out);
    expect(kids).toHaveLength(1);
    const choice = kids[0] as Group;
    expect(choice.selector).toBe("choice");
    expect(choice.children).toHaveLength(2);                          // one Option per selected chunk
    expect((choice.children[0] as Group).type).toBe("group");        // each option is an Option group (§8)
    expect((choice.children[0] as Group).children[0]!.id).toBe("a"); // ...holding the original bubble
  });

  it("round-trips losslessly after wrapping", () => {
    const s = selectChunks(stateOf([line("a"), line("b")]), 0, 1);
    const out = s.apply(wrapInGroup(s, "if")!);
    const sc = docToScene(out.doc);
    expect(docToScene(sceneToDoc(sc.scene, sc.strings)).scene).toEqual(sc.scene);
  });
});

const snippetPos = (s: EditorState, id: string): number => {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && (JSON.parse(n.attrs.raw).id ?? null) === id) { p = pos; return false; } return true; });
  return p;
};

describe("wrapChunk - the per-snippet wrap control", () => {
  it("wraps a single snippet in a group of the chosen kind, content preserved", () => {
    const s = stateOf([line("a"), line("b"), line("c")]);
    const out = s.apply(wrapChunk(s, snippetPos(s, "b"), "sequence")!);
    const kids = blockKids(out);
    expect(kids.map((c) => c.id.startsWith("g") ? "group" : c.id)).toEqual(["a", "group", "c"]);
    const g = kids[1] as Group;
    expect(g.selector).toBe("sequence");
    expect(g.children.map((c) => c.id)).toEqual(["b"]);   // just the one snippet
  });

  it("wrapping a single snippet in a choice makes a one-option choice", () => {
    const s = stateOf([line("a")]);
    const out = s.apply(wrapChunk(s, snippetPos(s, "a"), "choice")!);
    const choice = blockKids(out)[0] as Group;
    expect(choice.selector).toBe("choice");
    expect(choice.children).toHaveLength(1);
    expect((choice.children[0] as Group).children[0]!.id).toBe("a"); // option holds the snippet
  });

  it("also wraps a GROUP (a non-option group's edit popover offers wrap)", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "sequence", children: [line("a")] },
    ] }] };
    const s = EditorState.create({ doc: sceneToDoc(scene, {}) });
    let gpos = -1; s.doc.descendants((n, pos) => { if (gpos < 0 && n.type.name === "group") { gpos = pos; return false; } return true; });
    const out = s.apply(wrapChunk(s, gpos, "if")!);
    const outer = blockKids(out)[0] as Group;
    expect(outer.selector).toBe("branch");                  // the new wrapping group
    expect((outer.children[0] as Group).selector).toBe("sequence"); // ...holding the original group
  });
});

describe("setSnippetCondition", () => {
  it("sets and clears a snippet's eligibility condition", () => {
    const s = stateOf([line("a")]);
    const withCond = s.apply(setSnippetCondition(s, snippetPos(s, "a"), "  gold > 5  ")!);
    expect((blockKids(withCond)[0] as { condition?: string }).condition).toBe("gold > 5"); // trimmed
    const cleared = withCond.apply(setSnippetCondition(withCond, snippetPos(withCond, "a"), "")!);
    expect((blockKids(cleared)[0] as { condition?: unknown }).condition).toBeUndefined();
  });
});
