// ---------------------------------------------------------------------------
// Phase C: editing a group's behaviour from its header access-UI (groups §9) -
// selector, the `sequence` order x exhaust, and the eligibility condition. The
// fields ride in the group's `raw` overlay; setGroupProps rewrites it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene, Group } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { setGroupProps } from "../src/groups.js";

function stateWithGroup(g: Group): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [g] }] };
  return EditorState.create({ doc: sceneToDoc(scene, {}) });
}
const seqGroup = (): Group => ({ id: "g", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [{ id: "s1", type: "snippet", beats: [{ id: "L", kind: "line" }] }] });
const groupPos = (s: EditorState): number => { let p = -1; s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "group") p = pos; }); return p; };
const patch = (s: EditorState, p: object): Group => { const out = s.apply(setGroupProps(s, groupPos(s), p)!); return docToScene(out.doc).scene.blocks[0]!.children[0] as Group; };

describe("setGroupProps", () => {
  it("changes a sequence's order and exhaust", () => {
    const s = stateWithGroup(seqGroup());
    expect(patch(s, { order: "shuffle" }).options).toEqual({ order: "shuffle", exhaust: "once" });
    expect(patch(s, { exhaust: "stick" }).options).toEqual({ order: "sequential", exhaust: "stick" });
  });

  it("sets and clears the eligibility condition", () => {
    const s = stateWithGroup(seqGroup());
    expect(patch(s, { condition: "@hp > 5" }).condition).toBe("@hp > 5");
    const withCond = s.apply(setGroupProps(s, groupPos(s), { condition: "@hp > 5" })!);
    expect((docToScene(withCond.doc).scene.blocks[0]!.children[0] as Group).condition).toBe("@hp > 5");
    expect(patch(withCond, { condition: "  " }).condition).toBeUndefined(); // blank clears it
  });

  it("switching selector drops sequence options; switching to sequence seeds defaults; run omits selector", () => {
    const s = stateWithGroup(seqGroup());
    const fm = patch(s, { selector: "branch" });
    expect(fm.selector).toBe("branch");
    expect(fm.options).toBeUndefined();

    const run = patch(s, { selector: "run" });
    expect(run.selector).toBeUndefined();  // `run` is the omitted default

    const fmState = s.apply(setGroupProps(s, groupPos(s), { selector: "branch" })!);
    const backToSeq = patch(fmState, { selector: "sequence" });
    expect(backToSeq.options).toEqual({ order: "sequential", exhaust: "once" }); // re-seeded
  });
});

describe("setGroupProps - option sticky / fallback (spec §5)", () => {
  const choiceScene = (): Scene => ({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "C1", kind: "text" }, children: [{ id: "o1c", type: "snippet", jump: { to: "END" } }] },
      { id: "o2", type: "group", prompt: { id: "C2", kind: "text" }, children: [{ id: "o2c", type: "snippet", jump: { to: "END" } }] },
    ] } as Group,
  ] }] });
  const optionPos = (s: EditorState, rawId: string): number => {
    let p = -1;
    s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "group" && (JSON.parse(n.attrs.raw as string) as { id?: string }).id === rawId) p = pos; return p < 0; });
    return p;
  };
  const options = (s: EditorState): Group[] => (docToScene(s.doc).scene.blocks[0]!.children[0] as Group).children as Group[];

  it("sets and clears sticky on an option (default omitted = once-only)", () => {
    let s = EditorState.create({ doc: sceneToDoc(choiceScene(), { C1: "One", C2: "Two" }) });
    expect(options(s)[0]!.sticky).toBeUndefined();
    s = s.apply(setGroupProps(s, optionPos(s, "o1"), { sticky: true })!);
    expect(options(s)[0]!.sticky).toBe(true);
    s = s.apply(setGroupProps(s, optionPos(s, "o1"), { sticky: false })!);
    expect(options(s)[0]!.sticky).toBeUndefined();
  });

  it("setting fallback on one option clears it on its siblings (single fallback per choice)", () => {
    let s = EditorState.create({ doc: sceneToDoc(choiceScene(), { C1: "One", C2: "Two" }) });
    s = s.apply(setGroupProps(s, optionPos(s, "o1"), { fallback: true })!);
    expect(options(s).map((o) => o.fallback)).toEqual([true, undefined]);
    s = s.apply(setGroupProps(s, optionPos(s, "o2"), { fallback: true })!);
    expect(options(s).map((o) => o.fallback)).toEqual([undefined, true]); // o1's fallback was cleared
  });
});
