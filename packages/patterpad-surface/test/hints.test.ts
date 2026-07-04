// ---------------------------------------------------------------------------
// Z10: the hint bar's coverage. Every reachable cursor state yields a sensible,
// non-empty hint set (the spec §16 coverage check), and the key states match.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { context } from "../src/context.js";
import { hintsFor, multiSelectHints } from "../src/hints.js";
import { multiSelectState, SET_MULTI } from "../src/multiselect.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "M", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA", direction: "soft" },
        { id: "L2", kind: "line", character: "ANNA" }, // empty content
        { id: "P1", kind: "text" },
        { id: "P2", kind: "text" }, // empty free-text line
        { id: "A1", kind: "gameEvent" },
      ], jump: { to: "END" } },
    ] },
  ],
};
const doc = sceneToDoc(scene, { L1: "Hi", P1: "Narr" });

function zonePos(beatId: string, role: string): number {
  let p = -1;
  doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if ((node.type.name === "line" || node.type.name === "prose") && node.attrs.id === beatId) {
      node.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1; });
      return false;
    }
    return true;
  });
  return p;
}
const atomPos = (typeName: string): number => {
  let p = -1;
  doc.descendants((n, pos) => { if (p < 0 && n.type.name === typeName) { p = pos; return false; } return true; });
  return p;
};
const caret = (beatId: string, role: string, offset = 0): EditorState =>
  EditorState.create({ doc, selection: TextSelection.create(doc, zonePos(beatId, role) + offset) });
const onAtom = (typeName: string): EditorState =>
  EditorState.create({ doc, selection: NodeSelection.create(doc, atomPos(typeName)) });
const keys = (state: EditorState): string[] => hintsFor(context(state)).map((h) => h.key);

describe("hint coverage - every cursor state has hints", () => {
  const states: Array<[string, EditorState]> = [
    ["cue", caret("L1", "cue")],
    ["paren", caret("L1", "paren")],
    ["say content", caret("L1", "say", 2)],
    ["say empty", caret("L2", "say")],
    ["prose start", caret("P1", "say", 0)],
    ["prose content", caret("P1", "say", 2)],
    ["game-event atom", onAtom("gameEvent")],
  ];
  it.each(states)("%s yields a non-empty hint set", (_name, state) => {
    expect(hintsFor(context(state)).length).toBeGreaterThan(0);
  });
});

describe("hint content matches the state", () => {
  it("cue offers type-to-filter / accept / free-text / direction", () => {
    expect(keys(caret("L1", "cue"))).toEqual(["type", "Enter", "Space", "("]);
  });
  it("a direction offers close", () => {
    expect(keys(caret("L1", "paren"))).toEqual([")"]);
  });
  it("empty dialogue content offers next-line / end-bubble / direction / insert", () => {
    expect(keys(caret("L2", "say"))).toEqual(["Enter", "Shift-Enter", "(", "/"]);
  });
  it("a cue on an empty line offers insert (the / menu is reachable from the cue too)", () => {
    expect(keys(caret("L2", "cue"))).toEqual(["type", "Enter", "Space", "(", "/"]); // L2's say is empty
    expect(keys(caret("L1", "cue"))).not.toContain("/");                            // L1 has spoken content
  });
  it("an empty free-text line offers insert", () => {
    expect(keys(caret("P2", "say", 0))).toContain("/"); // P2 has no text -> the / menu is reachable
    expect(keys(caret("P1", "say", 0))).not.toContain("/"); // P1 has text -> no insert
  });
  it("Enter never ends the bubble in content (Shift-Enter does)", () => {
    expect(keys(caret("L1", "say", 2))).toContain("Shift-Enter"); // content present
    expect(hintsFor(context(caret("L1", "say", 2))).find((h) => h.key === "Enter")?.label).toBe("next line");
  });
  it("a free-text start offers promotion to dialogue", () => {
    expect(keys(caret("P1", "say", 0))).toContain("Tab");
  });
  it("a game-event atom offers its delete affordance", () => {
    expect(keys(onAtom("gameEvent"))).toEqual(["×"]);
  });
});

describe("multiSelectHints (a multi-chunk run, §6)", () => {
  const runScene: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "s1", type: "snippet", beats: [{ id: "M1", kind: "line" }] },
      { id: "s2", type: "snippet", beats: [{ id: "M2", kind: "line" }] },
    ] },
  ] };
  const runDoc = sceneToDoc(runScene, { M1: "a", M2: "b" });

  it("returns delete / move / wrap hints when a set of >=2 chunks is selected", () => {
    let st = EditorState.create({ doc: runDoc, plugins: [multiSelectState()] });
    st = st.apply(st.tr.setMeta(SET_MULTI, { ids: ["s1", "s2"], anchor: "s1" }));
    expect(multiSelectHints(st)?.map((h) => h.label)).toEqual(["delete", "move", "wrap…"]);
  });

  it("returns null for a single caret (so the normal beat hints show)", () => {
    expect(multiSelectHints(EditorState.create({ doc: runDoc, selection: TextSelection.create(runDoc, 1) }))).toBeNull();
  });
});
