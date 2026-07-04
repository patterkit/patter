// ---------------------------------------------------------------------------
// Z6: the Backspace deletion + merge spine. Steps say -> direction -> cue, then
// merges an empty-named line into the previous line / bubble, with the
// non-mergeable-target guard (no merging into a game event / jump).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { canonicalStringify } from "@patterkit/core";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { backspace } from "../src/delete.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "M", children: [
      { id: "sn1", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA", direction: "soft" },
        { id: "L2", kind: "line" }, // no speaker
      ] },
      { id: "sn2", type: "snippet", beats: [{ id: "L3", kind: "line", character: "BO" }] },
      { id: "sn3", type: "snippet", beats: [{ id: "L4", kind: "line" }] }, // first beat, empty speaker
      { id: "sn4", type: "snippet", beats: [{ id: "A1", kind: "gameEvent" }, { id: "L5", kind: "line" }] },
    ] },
  ],
};
const strings = { L1: "Hello", L2: "World", L3: "Hey", L4: "Bye", L5: "Z" };

function state(): EditorState { return EditorState.create({ doc: sceneToDoc(scene, strings) }); }
function zonePos(s: EditorState, beatId: string, role: string): number {
  let p = -1;
  s.doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if ((node.type.name === "line" || node.type.name === "prose") && node.attrs.id === beatId) {
      node.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1; });
      return false;
    }
    return true;
  });
  return p;
}
const caret = (beatId: string, role: string, offset = 0): EditorState => {
  const s = state();
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, beatId, role) + offset)));
};
const run = (s: EditorState, cmd: Command): EditorState => { let n = s; cmd(s, (tr) => { n = s.apply(tr); }); return n; };
const sceneOf = (s: EditorState) => docToScene(s.doc).scene;
const snippets = (sc: Scene) => sc.blocks[0]!.children as unknown as Array<Record<string, unknown>>;
const beats = (snip: Record<string, unknown>) => (snip.beats ?? []) as Array<{ id: string }>;

describe("Backspace - stepping the spine", () => {
  it("from content-start with a direction, steps into the direction", () => {
    const s = run(caret("L1", "say", 0), backspace);
    expect(context(s).zone).toMatchObject({ role: "paren", atEnd: true });
  });
  it("from content-start with no direction, steps into the cue", () => {
    const s = run(caret("L2", "say", 0), backspace);
    expect(context(s).zone).toMatchObject({ role: "cue", atEnd: true });
  });
});

describe("Backspace - stepping into the character selects it whole (change speaker)", () => {
  const build = (): EditorState => {
    const sc: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [
            { id: "N1", kind: "line", character: "ANNA" },            // named, no direction
            { id: "N2", kind: "line", character: "BO", direction: "soft" }, // named + direction
          ] },
        ] },
      ],
    };
    return EditorState.create({ doc: sceneToDoc(sc, { N1: "Hello", N2: "Hi" }) });
  };
  const at = (s: EditorState, beatId: string, role: string): EditorState =>
    s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, beatId, role))));
  const selectedText = (s: EditorState): string => s.doc.textBetween(s.selection.from, s.selection.to);

  it("content-start, no direction: lands in the cue with the whole name selected", () => {
    const s = run(at(build(), "N1", "say"), backspace);
    expect(context(s).zone?.role).toBe("cue");
    expect(s.selection.empty).toBe(false);   // whole name selected, popup opens
    expect(selectedText(s)).toBe("ANNA");
  });

  it("direction-start: steps into the cue with the whole name selected", () => {
    const s = run(at(build(), "N2", "paren"), backspace);
    expect(context(s).zone?.role).toBe("cue");
    expect(s.selection.empty).toBe(false);
    expect(selectedText(s)).toBe("BO");
  });
});

describe("Backspace - merge", () => {
  it("an empty-named line merges its content into the previous line", () => {
    const s = run(caret("L2", "cue", 0), backspace);
    const sn1 = snippets(sceneOf(s))[0]!;
    expect(beats(sn1).map((b) => b.id)).toEqual(["L1"]);
    expect(docToScene(s.doc).strings.L1).toBe("HelloWorld");
  });
  it("an empty-named first line merges into the previous bubble", () => {
    const s = run(caret("L4", "cue", 0), backspace);
    const snips = snippets(sceneOf(s));
    // sn3 is gone; its content joined sn2's last line
    expect(snips.map((sn) => sn.id)).toEqual(["sn1", "sn2", "sn4"]);
    expect(docToScene(s.doc).strings.L3).toBe("HeyBye");
  });

  it("deletes a game event above a line (Backspace at the line's start)", () => {
    const s = run(caret("L5", "cue", 0), backspace); // prev beat is the game-event A1
    const sn4 = snippets(sceneOf(s)).find((sn) => sn.id === "sn4")!;
    expect(beats(sn4).map((b) => b.id)).toEqual(["L5"]); // A1 deleted, the line stays put
    expect(docToScene(s.doc).strings.L5).toBe("Z");      // line content intact
    expect(context(s).beat?.id).toBe("L5");              // caret still in the line
  });
});

describe("Backspace - non-mergeable guard", () => {
  it("refuses a BUBBLE merge into a bubble ending in a game event (no content loss)", () => {
    const sc: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sa", type: "snippet", beats: [{ id: "X1", kind: "line", character: "ANNA" }, { id: "X2", kind: "gameEvent" }] },
          { id: "sb", type: "snippet", beats: [{ id: "X3", kind: "line" }] }, // empty-named first line
        ] },
      ],
    };
    const st = EditorState.create({ doc: sceneToDoc(sc, { X1: "Hi", X3: "World" }) });
    let p = -1;
    st.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "line" && n.attrs.id === "X3") { n.forEach((z, o) => { if (z.type.name === "cue") p = pos + 1 + o + 1; }); return false; } return true; });
    const at = st.apply(st.tr.setSelection(TextSelection.create(st.doc, p)));
    const before = canonicalStringify(docToScene(at.doc).scene);
    const out = run(at, backspace);
    expect(canonicalStringify(docToScene(out.doc).scene)).toBe(before); // refused; "World" not lost
  });
});

describe("Backspace on a character-name HIGHLIGHT dissolves the line into the previous", () => {
  const sceneOfBeats = (beats: Array<Record<string, unknown>>, str: Record<string, string>) =>
    EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "M", children: [{ id: "sn", type: "snippet", beats: beats as never }] }] }, str) });
  /** Select the whole cue token of line `id` (the character-name highlight state). */
  const cueSelected = (s: EditorState, id: string): EditorState => {
    let from = -1, to = -1;
    s.doc.descendants((n, pos) => { if (from < 0 && n.type.name === "line" && n.attrs.id === id) { n.forEach((z, o) => { if (z.type.name === "cue") { from = pos + 1 + o + 1; to = from + z.content.size; } }); } return true; });
    return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
  };
  const firstBeat = (s: EditorState) => (snippets(sceneOf(s))[0]! as { beats: Array<{ id: string; character?: string; direction?: string }> }).beats;
  const sayOf = (s: EditorState, id: string) => docToScene(s.doc).strings[id];

  it("Rule C - previous line is dialogue WITH content: drop this line's direction, concatenate the say", () => {
    const s0 = cueSelected(sceneOfBeats([
      { id: "P", kind: "line", character: "ANNA", direction: "soft" },
      { id: "L", kind: "line", character: "BO", direction: "loud" },
    ], { P: "Hello", L: "World" }), "L");
    const s = run(s0, backspace);
    const beats = firstBeat(s);
    expect(beats.map((b) => b.id)).toEqual(["P"]);     // L dissolved
    expect(sayOf(s, "P")).toBe("HelloWorld");           // content concatenated
    expect(beats[0]!.direction).toBe("soft");           // P keeps its own direction; L's "loud" dropped
  });

  it("Rule A - previous line has a name but NO content: take everything (say AND direction)", () => {
    const s0 = cueSelected(sceneOfBeats([
      { id: "P", kind: "line", character: "ANNA" },
      { id: "L", kind: "line", character: "BO", direction: "loud" },
    ], { P: "", L: "World" }), "L");
    const s = run(s0, backspace);
    const beats = firstBeat(s);
    expect(beats.map((b) => b.id)).toEqual(["P"]);
    expect(beats[0]!.character).toBe("ANNA");            // P keeps its name
    expect(sayOf(s, "P")).toBe("World");                 // gains L's content
    expect(beats[0]!.direction).toBe("loud");            // ...and L's direction
  });

  it("Rule B - previous line is Text: stay text, inline the direction", () => {
    const s0 = cueSelected(sceneOfBeats([
      { id: "P", kind: "text" },
      { id: "L", kind: "line", character: "BO", direction: "loud" },
    ], { P: "Narration. ", L: "World" }), "L");
    const s = run(s0, backspace);
    const beats = (snippets(sceneOf(s))[0]! as { beats: Array<{ id: string; kind: string }> }).beats;
    expect(beats.map((b) => b.id)).toEqual(["P"]);
    expect(beats[0]!.kind).toBe("text");                 // stays text
    expect(sayOf(s, "P")).toBe("Narration. (loud) World"); // direction inlined into the text
  });
});

describe("Backspace - free-text (prose) line at its start merges into the line above", () => {
  // Free text has no cue/paren prefix, so the say-start IS the line's left edge.
  const build = (): EditorState => {
    const sc: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [
            { id: "D1", kind: "line", character: "ANNA" }, // dialogue line above
            { id: "T1", kind: "text" },                    // free text with content
            { id: "T2", kind: "text" },                    // empty free text
          ] },
        ] },
      ],
    };
    return EditorState.create({ doc: sceneToDoc(sc, { D1: "Hello", T1: "World", T2: "" }) });
  };
  const sayCaret = (s: EditorState, beatId: string): EditorState =>
    s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, beatId, "say"))));
  const beatIds = (s: EditorState) => beats(snippets(sceneOf(s))[0]!).map((b) => b.id);

  it("a text line with content merges into the dialogue line above (content appended)", () => {
    const s = run(sayCaret(build(), "T1"), backspace);
    expect(beatIds(s)).toEqual(["D1", "T2"]);                 // T1 gone
    expect(docToScene(s.doc).strings.D1).toBe("HelloWorld");  // its content appended
  });
  it("an empty text line is deleted (merges nothing into the line above)", () => {
    const s = run(sayCaret(build(), "T2"), backspace);
    expect(beatIds(s)).toEqual(["D1", "T1"]); // T2 gone
    expect(docToScene(s.doc).strings.T1).toBe("World"); // unchanged
  });
});
