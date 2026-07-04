// ---------------------------------------------------------------------------
// ④ Split / Join (the action menu's structural twins of Shift-Enter / merge-up).
// splitSnippetHere splits a bubble so the caret's beat starts a new bubble (the
// terminal jump + a fresh id ride the tail); joinSnippet merges a bubble with an
// adjacent sibling snippet (beats concatenate; the trailing jump is kept).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { splitSnippetHere } from "../src/lines.js";
import { joinSnippet } from "../src/groups.js";

function stateOf(children: Scene["blocks"][0]["children"]): EditorState {
  return EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] }, {}) });
}
/** Position of the snippet whose model id is `id`. */
function snipPos(s: EditorState, id: string): number {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && (JSON.parse(n.attrs.raw).id ?? null) === id) { p = pos; return false; } return true; });
  return p;
}
/** Drop the caret into the say zone of beat `beatId`. */
function caretInSay(s: EditorState, beatId: string): EditorState {
  let say = -1;
  s.doc.descendants((n, pos) => {
    if (say < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === "say") say = pos + 1 + o + 1; }); return false; }
    return true;
  });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, say)));
}
const snips = (s: EditorState) => docToScene(s.doc).scene.blocks[0]!.children as Array<{ id: string; type: string; beats?: { id: string }[]; jump?: { to: string } }>;

const line3 = { id: "sn", type: "snippet" as const, jump: { to: "END" }, beats: [
  { id: "L1", kind: "line" as const, character: "A" },
  { id: "L2", kind: "line" as const, character: "A" },
  { id: "L3", kind: "line" as const, character: "A" },
] };

describe("splitSnippetHere", () => {
  it("splits so the caret's beat starts a new bubble; jump + fresh id ride the tail", () => {
    const s = caretInSay(stateOf([line3]), "L2");
    const out = s.apply(splitSnippetHere(s, snipPos(s, "sn"))!);
    const cs = snips(out);
    expect(cs).toHaveLength(2);
    expect(cs[0]!.id).toBe("sn");
    expect(cs[0]!.beats!.map((b) => b.id)).toEqual(["L1"]);     // A keeps the beats before the caret
    expect(cs[0]!.jump).toBeUndefined();                       // ...and loses the terminal jump
    expect(cs[1]!.id).not.toBe("sn");                            // B gets a fresh id
    expect(cs[1]!.beats!.map((b) => b.id)).toEqual(["L2", "L3"]); // ...and the caret beat onward
    expect(cs[1]!.jump).toEqual({ to: "END" });               // ...with the jump
  });

  it("refuses when the caret is at the first beat (A would be empty)", () => {
    const s = caretInSay(stateOf([line3]), "L1");
    expect(splitSnippetHere(s, snipPos(s, "sn"))).toBeNull();
  });

  it("refuses when the caret is not inside the named snippet", () => {
    const s = caretInSay(stateOf([line3, { id: "other", type: "snippet", beats: [{ id: "X", kind: "line" }] }]), "X");
    expect(splitSnippetHere(s, snipPos(s, "sn"))).toBeNull();
  });
});

describe("joinSnippet", () => {
  const two: Scene["blocks"][0]["children"] = [
    { id: "a", type: "snippet", beats: [{ id: "A1", kind: "line", character: "A" }] },
    { id: "b", type: "snippet", jump: { to: "END" }, beats: [{ id: "B1", kind: "line", character: "B" }] },
  ];

  it("joins UP: the second bubble merges into the first; beats concatenate, jump kept", () => {
    const s = stateOf(two);
    const out = s.apply(joinSnippet(s, snipPos(s, "b"), "up")!);
    const cs = snips(out);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.id).toBe("a");                              // the leading snippet's identity is kept
    expect(cs[0]!.beats!.map((b) => b.id)).toEqual(["A1", "B1"]);
    expect(cs[0]!.jump).toEqual({ to: "END" });            // the trailing jump survives
  });

  it("joins DOWN: equivalent merge from the leading bubble", () => {
    const s = stateOf(two);
    const out = s.apply(joinSnippet(s, snipPos(s, "a"), "down")!);
    const cs = snips(out);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.beats!.map((b) => b.id)).toEqual(["A1", "B1"]);
  });

  it("refuses at a container edge and when the neighbour is a group", () => {
    const s = stateOf([{ id: "a", type: "snippet", beats: [{ id: "A1", kind: "line" }] }, { id: "g", type: "group", selector: "sequence", children: [{ id: "x", type: "snippet", beats: [{ id: "X1", kind: "line" }] }] }]);
    expect(joinSnippet(s, snipPos(s, "a"), "up")).toBeNull();   // nothing before
    expect(joinSnippet(s, snipPos(s, "a"), "down")).toBeNull(); // next sibling is a group
  });
});
