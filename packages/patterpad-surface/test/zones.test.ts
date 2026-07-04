// ---------------------------------------------------------------------------
// Z2: the zone context + the horizontal navigation spine. We place carets in
// specific zones of a known doc and assert the resolved zone/beat, then drive
// arrowRight/arrowLeft and assert the cursor steps cue -> paren -> say and wraps
// across line boundaries (including onto game-event/jump atoms).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { context } from "../src/context.js";
import { arrowLeft, arrowRight } from "../src/navigation.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "M", children: [
      { id: "sn1", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA", direction: "soft" },
        { id: "T1", kind: "text" },
      ] },
      { id: "sn2", type: "snippet", beats: [
        { id: "L2", kind: "line", character: "BO" },
        { id: "A1", kind: "gameEvent" },
      ] },
      { id: "sn3", type: "snippet", beats: [{ id: "L3", kind: "line", character: "ANNA" }], jump: { to: "END" } },
    ] },
  ],
};
const strings = { L1: "Hello", T1: "Narr", L2: "Hi", L3: "Bye" };
const doc = sceneToDoc(scene, strings);

function zoneStart(beatId: string, role: string): { start: number; len: number } {
  let r: { start: number; len: number } | null = null;
  doc.descendants((node, pos) => {
    if (r) return false;
    if ((node.type.name === "line" || node.type.name === "prose") && node.attrs.id === beatId) {
      node.forEach((z, offset) => { if (z.type.name === role) r = { start: pos + 1 + offset + 1, len: z.content.size }; });
      return false;
    }
    return true;
  });
  return r!;
}
const caret = (beatId: string, role: string, offset = 0): EditorState =>
  EditorState.create({ doc, selection: TextSelection.create(doc, zoneStart(beatId, role).start + offset) });
const run = (state: EditorState, cmd: Command): EditorState => {
  let next = state;
  cmd(state, (tr) => { next = state.apply(tr); });
  return next;
};

describe("zone context", () => {
  it("resolves the zone, beat kind, and direction presence", () => {
    const c = context(caret("L1", "cue"));
    expect(c.zone).toMatchObject({ role: "cue", isFirstZone: true, atStart: true });
    expect(c.beat).toMatchObject({ kind: "line", id: "L1", index: 0 });
    expect(c.hasDirection).toBe(true);
    expect(c.firstBeatInSnippet).toBe(true);
  });
  it("flags zone end and last-zone for a content caret", () => {
    const c = context(caret("L1", "say", 5)); // "Hello"
    expect(c.zone).toMatchObject({ role: "say", isLastZone: true, atEnd: true });
  });
  it("a prose beat has a single say zone (first and last)", () => {
    const c = context(caret("T1", "say"));
    expect(c.beat?.kind).toBe("prose");
    expect(c.zone).toMatchObject({ role: "say", isFirstZone: true, isLastZone: true });
    expect(c.hasDirection).toBe(false);
  });
});

describe("arrowRight - forward spine", () => {
  it("steps cue -> paren -> say within a line", () => {
    let s = run(caret("L1", "cue", 4), arrowRight); // end of "ANNA"
    expect(context(s).zone).toMatchObject({ role: "paren", atStart: true });
    s = run(caret("L1", "paren", 4), arrowRight);   // end of "soft"
    expect(context(s).zone).toMatchObject({ role: "say", atStart: true });
  });
  it("wraps from a line's content end to the next line's first zone", () => {
    const s = run(caret("L1", "say", 5), arrowRight); // end of "Hello" -> T1
    expect(context(s).beat?.id).toBe("T1");
    expect(context(s).zone).toMatchObject({ role: "say", atStart: true });
  });
  it("wraps across snippets and onto a game-event atom", () => {
    let s = run(caret("L2", "say", 2), arrowRight); // end of "Hi" -> A1 (game-event atom)
    expect(context(s).beat?.kind).toBe("gameEvent");
    expect(context(s).zone).toBeNull();
    s = run(s, arrowRight); // off the atom -> next beat L3 cue
    expect(context(s).beat?.id).toBe("L3");
    expect(context(s).zone?.role).toBe("cue");
  });
});

describe("arrowLeft - reverse spine", () => {
  it("steps say -> paren -> cue (mirror)", () => {
    let s = run(caret("L1", "say", 0), arrowLeft);
    expect(context(s).zone).toMatchObject({ role: "paren", atEnd: true });
    s = run(caret("L1", "paren", 0), arrowLeft);
    expect(context(s).zone).toMatchObject({ role: "cue", atEnd: true });
  });
  it("wraps from a line's first zone back to the previous line's content end", () => {
    const s = run(caret("L2", "cue", 0), arrowLeft); // -> previous beat T1 content end
    expect(context(s).beat?.id).toBe("T1");
    expect(context(s).zone).toMatchObject({ role: "say", atEnd: true });
  });
  it("does nothing at the very start of the document", () => {
    let handled = false;
    arrowLeft(caret("L1", "cue", 0), () => { handled = true; });
    expect(handled).toBe(false);
  });
});
