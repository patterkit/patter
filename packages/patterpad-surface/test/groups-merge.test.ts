// ---------------------------------------------------------------------------
// Phase C: merge guards at group seams (groups §10). Backspace at column 0 merges
// WITHIN the immediate container (a group), and is a NO-OP at a group's first
// bubble (it must never silently merge content out across the group boundary).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { backspace } from "../src/delete.js";
import { context } from "../src/context.js";
import { hintsFor } from "../src/hints.js";

/** A block with one group holding two empty-cue bubbles (b1 has content, b2 empty). */
function state(): EditorState {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "sequence", children: [
          { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line" }] },
          { id: "s2", type: "snippet", beats: [{ id: "L2", kind: "line" }] },
        ] },
      ] },
    ],
  };
  return EditorState.create({ doc: sceneToDoc(scene, { L1: "first", L2: "" }) });
}
/** Caret at the (empty) cue start of the line beat `id`. */
function atCue(s: EditorState, id: string): EditorState {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "line" && n.attrs.id === id) { n.forEach((z, o) => { if (z.type.name === "cue") p = pos + 1 + o + 1; }); } return true; });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, p)));
}
const run = (s: EditorState) => { let n = s; backspace(s, (tr) => { n = s.apply(tr); }); return n; };
const groupKids = (s: EditorState) => {
  const g = docToScene(s.doc).scene.blocks[0]!.children[0] as { children: { id: string }[] };
  return g.children.map((c) => c.id);
};

describe("merge guards at group seams", () => {
  it("merges WITHIN the group (2nd bubble joins the 1st), not across the block", () => {
    const out = run(atCue(state(), "L2"));   // backspace at the 2nd bubble's left edge
    expect(groupKids(out)).toEqual(["s1"]);  // s2 merged into s1, still inside the group
  });

  it("is a NO-OP at the group's FIRST bubble (never merges out of the group)", () => {
    const before = docToScene(state().doc).scene;
    const out = run(atCue(state(), "L1"));    // backspace at the first bubble's left edge
    expect(docToScene(out.doc).scene).toEqual(before); // unchanged - structure preserved
  });

  it("shows a soft 'group edge' hint at the no-op spot, not at the mergeable 2nd bubble", () => {
    const first = context(atCue(state(), "L1"));
    expect(first.inGroup).toBe(true);
    expect(hintsFor(first).some((h) => h.label === "group edge")).toBe(true);
    expect(hintsFor(context(atCue(state(), "L2"))).some((h) => h.label === "group edge")).toBe(false);
  });
});
