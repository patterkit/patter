// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase B: groups are real, recursive container nodes. This asserts (1) a scene
// with NESTED groups + Option groups round-trips losslessly through the bridge,
// and (2) it renders as nested rails (groups §3) with the choice's Option groups
// inside the choice rail.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { canonicalStringify } from "@patterkit/core";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene, type Strings } from "../src/bridge.js";
import { nodeViews } from "./views.js";

// A block with: a line, a shuffle SEQUENCE containing a nested FIRST-MATCH branch,
// and a CHOICE whose options are Option groups (one rich, one pure-jump + secret).
const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "l1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
      { id: "seq", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
        { id: "s1", type: "snippet", beats: [{ id: "S1", kind: "text" }] },
        { id: "br", type: "group", selector: "branch", children: [
          { id: "x1", type: "snippet", condition: "@flag", beats: [{ id: "B1", kind: "line", character: "BO" }] },
          { id: "x2", type: "snippet", beats: [{ id: "B2", kind: "line", character: "BO" }] },
        ] },
      ] },
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "opt1", type: "group", prompt: { id: "C1", kind: "text" }, children: [
          { id: "o1", type: "snippet", beats: [{ id: "O1", kind: "line", character: "ANNA" }], jump: { to: "END" } },
        ] },
        { id: "opt2", type: "group", prompt: { id: "C2", kind: "text" }, secretUntilEligible: true, condition: "@secret", children: [
          { id: "o2", type: "snippet", jump: { to: "END" } },
        ] },
      ] },
    ] },
  ],
};
const strings: Strings = { L1: "hello", S1: "narr", B1: "true branch", B2: "false branch", O1: "say yes" };

describe("Phase B: recursive groups", () => {
  it("round-trips nested groups + Option groups losslessly", () => {
    const { scene: out, strings: outStrings } = docToScene(sceneToDoc(scene, strings));
    expect(canonicalStringify(out)).toBe(canonicalStringify(scene));
    expect(outStrings).toEqual(strings);
  });

  it("renders nesting as nested rails, with the choice's Option groups inside", () => {
    const mount = document.createElement("div"); document.body.appendChild(mount);
    const view = new EditorView(mount, { state: EditorState.create({ doc: sceneToDoc(scene, strings) }), nodeViews });
    const dom = view.dom as HTMLElement;

    // the sequence rail, labelled with its order x exhaust, containing a nested branch rail
    const seq = [...dom.querySelectorAll(".group-rail")].find((r) => r.querySelector(".group-rail-label")?.textContent?.startsWith("sequence"))!;
    expect(seq.querySelector(".group-rail-label")?.textContent).toBe("sequence · shuffle · repeat");
    expect(seq.querySelector(".group-rail-body > .group-rail .group-rail-label")?.textContent).toBe("branch · first match");

    // the choice rail holds its two Option groups (rails), not bare bubbles
    const choice = dom.querySelector(".group-rail.is-choice")!;
    expect(choice.querySelector(".group-rail-label")?.textContent).toBe("choice");
    expect(choice.querySelectorAll(".group-rail-body > .group-rail.is-option").length).toBe(2);
    view.destroy();
  });
});
