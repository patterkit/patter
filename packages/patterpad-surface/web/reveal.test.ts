// ---------------------------------------------------------------------------
// revealNode caret targeting: jumping to a dialogue line must land the caret in
// the SAY text, never on the leading cue token (which would select the speaker
// name and pop the cast selector). We pin the targeting `revealNode` uses -
// `sayStartOf` lands inside the say zone, where the old `beatPos + 1` landed in
// the cue.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Selection, NodeSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { patterSchema as S } from "../src/schema.js";
import { sceneToDoc } from "../src/bridge.js";
import { sayStartOf } from "../src/zoneutil.js";

function lineDoc(character: string, say: string) {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character }] }] },
    ],
  };
  return sceneToDoc(scene, { L1: say });
}

describe("revealNode caret targeting (line beats)", () => {
  it("targets the SAY zone, not the cue, for a line with a speaker", () => {
    const doc = lineDoc("BO", "What'll it be?");
    const sayStart = sayStartOf(doc, "L1");
    expect(sayStart).toBeGreaterThanOrEqual(0);
    // the reveal target is inside the say zone (spoken text), so the caret rests in content
    expect(doc.resolve(sayStart).parent.type.name).toBe("say");
    // and Selection.near (what revealNode dispatches through) keeps the empty caret there
    const sel = Selection.near(doc.resolve(sayStart));
    expect(sel.empty).toBe(true);
    expect(sel.$head.parent.type.name).toBe("say");

    // contrast: the OLD target - Selection.near(line node start + 1) - landed in the CUE token (the bug)
    let linePos = -1;
    doc.descendants((n, p) => { if (n.type.name === "line") { linePos = p; return false; } return true; });
    expect(Selection.near(doc.resolve(linePos + 1)).$head.parent.type.name).toBe("cue");
  });

  it("still lands in the say zone when the line has no speaker yet", () => {
    const doc = lineDoc("", "Anonymous line.");
    const sayStart = sayStartOf(doc, "L1");
    expect(doc.resolve(sayStart).parent.type.name).toBe("say");
  });
});

describe("revealNode on an empty container (no say-target)", () => {
  // An empty group / beat-less bubble has no internal caret position. Selection.near(at + 1) then
  // bumps PAST it to the next selectable spot (the "one step beyond the actual problem" reveal), so
  // revealNode falls back to a NodeSelection ON the node. This pins that decision.
  it("Selection.near escapes an empty group, so a NodeSelection lands on it instead", () => {
    const group = S.nodes.group.create({ raw: JSON.stringify({ id: "g1", type: "group", selector: "sequence" }) }, []);
    const after = S.nodes.snippet.create({ raw: JSON.stringify({ id: "sn", type: "snippet" }) }, []);
    const block = S.nodes.block.create({ raw: JSON.stringify({ id: "b", type: "block", name: "M" }) }, [group, after]);
    const doc = S.nodes.doc.create({ raw: JSON.stringify({ id: "s", type: "scene", name: "S" }) }, [block]);

    let at = -1;
    doc.descendants((n, p) => { if (n.type.name === "group") { at = p; return false; } return true; });
    expect(at).toBeGreaterThanOrEqual(0);
    const node = doc.nodeAt(at)!;

    // the OLD target bumps outside the group's [at, at + nodeSize) range (the bug) ...
    const near = Selection.near(doc.resolve(at + 1));
    expect(near.from <= at || near.from >= at + node.nodeSize).toBe(true);

    // ... while the NodeSelection fallback lands squarely on the empty group.
    const sel = NodeSelection.create(doc, at);
    expect(sel.from).toBe(at);
    expect((sel as NodeSelection).node.type.name).toBe("group");
  });
});
