// ---------------------------------------------------------------------------
// Z4: the direction zone - open with "(", close with ")", remove; and it stores
// to LineBeat.direction. Driven on real EditorStates, read back via the bridge.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { openDirection, closeDirection, removeDirection } from "../src/direction.js";

const make = (direction?: string): EditorState => {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA", ...(direction ? { direction } : {}) }] },
      ] },
    ],
  };
  return EditorState.create({ doc: sceneToDoc(scene, { L1: "" }) });
};
const zoneStart = (state: EditorState, role: string): number => {
  let p = -1;
  state.doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if (node.type.name === "line") { node.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1; }); return false; }
    return true;
  });
  return p;
};
const caretIn = (state: EditorState, role: string, offset = 0): EditorState =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, zoneStart(state, role) + offset)));
const run = (state: EditorState, cmd: Command): EditorState | null => {
  let next: EditorState | null = null;
  cmd(state, (tr) => { next = state.apply(tr); });
  return next;
};
const beat = (state: EditorState) =>
  (docToScene(state.doc).scene.blocks[0]!.children[0] as { beats: Array<{ direction?: string }> }).beats[0]!;

describe("openDirection", () => {
  it("'(' in the cue zone inserts a direction and lands the caret in it; typing stores .direction", () => {
    const opened = run(caretIn(make(), "cue", 4), openDirection)!; // caret after "ANNA"
    expect(context(opened).zone?.role).toBe("paren");
    const typed = opened.apply(opened.tr.insertText("soft"));
    expect(beat(typed).direction).toBe("soft");
  });
  it("opens a direction at content-START even when content already exists", () => {
    const s = make();
    const withText = s.apply(s.tr.insertText("Hello", zoneStart(s, "say")));
    const atStart = withText.apply(withText.tr.setSelection(TextSelection.create(withText.doc, zoneStart(withText, "say")))); // offset 0
    const opened = run(atStart, openDirection)!;
    expect(context(opened).zone?.role).toBe("paren");
    expect(beat(opened).direction).toBeUndefined();    // empty until typed
    // content is preserved:
    expect(docToScene(opened.doc).strings.L1).toBe("Hello");
  });
  it("'(' is a literal MID-content (returns false)", () => {
    const s = make();
    const withText = s.apply(s.tr.insertText("Hello", zoneStart(s, "say")));
    const mid = withText.apply(withText.tr.setSelection(TextSelection.create(withText.doc, zoneStart(withText, "say") + 3)));
    expect(openDirection(mid, () => {})).toBe(false);
  });
});

describe("closeDirection", () => {
  it("')' from the paren zone returns the caret to content", () => {
    const s = run(caretIn(make(), "cue", 4), openDirection)!;
    const closed = run(s, closeDirection)!;
    expect(context(closed).zone?.role).toBe("say");
  });
});

describe("removeDirection", () => {
  it("deletes the direction and clears .direction", () => {
    const s = caretIn(make("weary"), "paren", 0);
    expect(beat(s).direction).toBe("weary");
    const tr = removeDirection(s)!;
    const removed = s.apply(tr);
    expect(beat(removed).direction).toBeUndefined();
    expect(context(removed).zone?.role).toBe("cue");
  });
});
