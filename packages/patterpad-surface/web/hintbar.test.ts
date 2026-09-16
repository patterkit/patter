// @vitest-environment jsdom
// The contextual hint bar draws the shell's keycaps: one `.shell-hint` per hint, a `kbd.shell-kbd`
// legend rendered platform-true from the hint's combo, the label beside it, and nothing typed between
// items (no "·", no "|"). An icon hint's keycap carries the drawn icon in place of a legend.

import { afterEach, describe, it, expect } from "vitest";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Scene } from "@patterkit/model";
import { setKeyPlatform } from "@wildwinter/app-shell";
import { sceneToDoc } from "../src/bridge.js";
import { createHintBar } from "./hintbar.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "M", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA" },
        { id: "A1", kind: "gameEvent" },
      ] },
    ] },
  ],
};
const doc = sceneToDoc(scene, { L1: "Hello" });

/** The caret at the END of L1's spoken text (the state whose hints carry Mod+T and Shift+Enter). */
function endOfSay(): EditorState {
  let p = -1;
  doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if (node.type.name === "line") { node.forEach((z, o) => { if (z.type.name === "say") p = pos + 1 + o + 1 + z.content.size; }); return false; }
    return true;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, p) });
}
function onAtom(): EditorState {
  let p = -1;
  doc.descendants((n, pos) => { if (p < 0 && n.type.name === "gameEvent") { p = pos; return false; } return true; });
  return EditorState.create({ doc, selection: NodeSelection.create(doc, p) });
}
/** The bar only needs the state and to be told the editor is focused. */
const fakeView = (state: EditorState): EditorView => ({ state, hasFocus: () => true } as unknown as EditorView);

afterEach(() => setKeyPlatform(undefined));

describe("createHintBar", () => {
  it("draws one shell keycap chip per hint, with the label as words and nothing typed between", () => {
    setKeyPlatform("mac");
    const host = document.createElement("div");
    createHintBar(host)(fakeView(endOfSay()));
    const bar = host.querySelector(".shell-hintbar")!;
    expect(bar).toBeTruthy();
    const chips = [...bar.querySelectorAll(".shell-hint")];
    expect(chips.map((c) => c.querySelector(".shell-hint-label")?.textContent)).toEqual(["next line", "free text", "end snippet"]);
    expect(chips.map((c) => c.querySelector("kbd.shell-kbd")?.textContent)).toEqual(["↩", "⌘T", "⇧↩"]);
    expect(host.textContent).not.toMatch(/[·|]/);
    expect(host.querySelector("[title]")).toBeNull();
  });

  it("spells the same hints out on Windows, one cap per key", () => {
    setKeyPlatform("win");
    const host = document.createElement("div");
    createHintBar(host)(fakeView(endOfSay()));
    const caps = [...host.querySelectorAll(".shell-hint")].map((c) => [...c.querySelectorAll("kbd")].map((k) => k.textContent));
    expect(caps).toEqual([["Enter"], ["Ctrl", "T"], ["Shift", "Enter"]]);
    expect(host.textContent).not.toContain("+");
  });

  it("an icon hint's keycap carries the drawn icon", () => {
    const host = document.createElement("div");
    createHintBar(host)(fakeView(onAtom()));
    const caps = [...host.querySelectorAll(".shell-hint kbd")];
    expect(caps.length).toBe(3);
    expect(caps[2]?.querySelector("svg[data-icon=close]")).toBeTruthy();
    expect(caps[2]?.textContent).toBe("");
  });

  it("draws nothing for an unfocused editor", () => {
    const host = document.createElement("div");
    createHintBar(host)({ state: endOfSay(), hasFocus: () => false } as unknown as EditorView);
    expect(host.childElementCount).toBe(0);
  });
});
