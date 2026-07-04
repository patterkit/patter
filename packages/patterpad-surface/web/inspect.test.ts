// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// inspect(): a node-selected structural element (block / group) surfaces AS the
// inspector's innermost level, so clicking a block heading or a group rail head
// tracks that element instead of leaving the last beat shown. (Regression: the
// inspector "only showed the last beat" for structural clicks.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { openScene } from "../src/load.js";
import { inspect, inspectScene } from "../src/inspect.js";
import flowSource from "../test/fixtures/tavern.patterflow?raw";
import locSource from "../test/fixtures/tavern.patterloc?raw";

const stateFor = (): EditorState => EditorState.create({ doc: openScene(flowSource, locSource).doc });

/** Position of the FIRST node of `typeName` in the doc (the chrome click node-selects exactly this). */
function firstPos(doc: PMNode, typeName: string): number {
  let pos = -1;
  doc.descendants((n, p) => { if (pos < 0 && n.type.name === typeName) { pos = p; return false; } return pos < 0; });
  return pos;
}

const kindsOf = (state: EditorState): string[] => inspect(state).levels.map((l) => l.kind);

describe("inspect() tracks a node-selected structural element", () => {
  it("a node-selected block -> [block, scene] (the stale leaf / snippet drop away)", () => {
    const s0 = stateFor();
    const state = s0.apply(s0.tr.setSelection(NodeSelection.create(s0.doc, firstPos(s0.doc, "block"))));
    expect(kindsOf(state)).toEqual(["block", "scene"]);
  });

  it("a node-selected group -> group innermost, with its block + scene ancestors", () => {
    const s0 = stateFor();
    const state = s0.apply(s0.tr.setSelection(NodeSelection.create(s0.doc, firstPos(s0.doc, "group"))));
    const kinds = kindsOf(state);
    expect(kinds[0]).toBe("group");                 // the clicked group is the focus
    expect(kinds[kinds.length - 1]).toBe("scene");  // ...scene is always outermost
    expect(kinds).toContain("block");               // ...and its block sits between
  });

  it("inspectScene() yields the scene-only context (the title click)", () => {
    expect(inspectScene(stateFor()).levels.map((l) => l.kind)).toEqual(["scene"]);
  });
});
