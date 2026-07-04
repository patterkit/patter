// ---------------------------------------------------------------------------
// Z7: line-type toggle (Cmd-T) and the in-flow flips (leading-space, Tab).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { toggleLineType, flipToFreeText, promoteToDialogue } from "../src/linetype.js";
import { enter } from "../src/lines.js";

function make(beat: Record<string, unknown>, content: string): EditorState {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [{ id: "sn", type: "snippet", beats: [beat as never] }] },
    ],
  };
  return EditorState.create({ doc: sceneToDoc(scene, { X: content }) });
}
const zonePos = (s: EditorState, role: string): number => {
  let p = -1;
  s.doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if (node.type.name === "line" || node.type.name === "prose") { node.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1; }); return false; }
    return true;
  });
  return p;
};
const at = (s: EditorState, role: string, offset = 0): EditorState =>
  s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, role) + offset)));
const run = (s: EditorState, cmd: Command): EditorState => { let n = s; cmd(s, (tr) => { n = s.apply(tr); }); return n; };
const beat = (s: EditorState) =>
  (docToScene(s.doc).scene.blocks[0]!.children[0] as { beats: Array<{ kind: string; character?: string }> }).beats[0]!;

describe("toggleLineType (Cmd-T)", () => {
  it("dialogue -> free text collapses the prefix into the content", () => {
    const s = run(at(make({ id: "X", kind: "line", character: "ANNA" }, "Hello"), "say"), toggleLineType);
    expect(beat(s).kind).toBe("text");
    expect(docToScene(s.doc).strings.X).toBe("ANNA: Hello");
  });
  it("free text -> dialogue parses a leading 'word:' as the speaker", () => {
    const s = run(at(make({ id: "X", kind: "text" }, "BO: Hi there"), "say"), toggleLineType);
    expect(beat(s)).toMatchObject({ kind: "line", character: "BO" });
    expect(docToScene(s.doc).strings.X).toBe("Hi there");
  });
  it("keeps the caret at the same spot in the content when collapsing the prefix", () => {
    const s = make({ id: "X", kind: "line", character: "ANNA" }, "Hello");
    const inSay = s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, "say") + 2))); // "He|llo"
    const out = run(inSay, toggleLineType);
    // prose content is "ANNA: Hello"; the caret should still sit before "llo" (offset 6 + 2)
    expect(context(out).zone).toMatchObject({ role: "say", offset: "ANNA: ".length + 2 });
  });

  it("free text -> dialogue with no prefix drops into an empty cue", () => {
    const s = run(at(make({ id: "X", kind: "text" }, "Just narration"), "say"), toggleLineType);
    expect(beat(s).kind).toBe("line");
    expect(beat(s).character).toBeUndefined();
    expect(context(s).zone?.role).toBe("cue");
  });

  it("free text -> dialogue extracts a leading (direction) into the direction zone", () => {
    const s = run(at(make({ id: "X", kind: "text" }, "ANNA: (soft) Hello"), "say"), toggleLineType);
    expect(beat(s)).toMatchObject({ kind: "line", character: "ANNA", direction: "soft" });
    expect(docToScene(s.doc).strings.X).toBe("Hello"); // direction no longer in content
  });

  it("round-trips a direction through the toggle (dialogue -> text -> dialogue)", () => {
    const dlg = make({ id: "X", kind: "line", character: "ANNA", direction: "weary" }, "Hi");
    const toText = run(at(dlg, "say"), toggleLineType);
    expect(beat(toText).kind).toBe("text");
    const back = run(at(toText, "say"), toggleLineType);
    expect(beat(back)).toMatchObject({ kind: "line", character: "ANNA", direction: "weary" });
    expect(docToScene(back.doc).strings.X).toBe("Hi");
  });
});

describe("flipToFreeText (leading space)", () => {
  it("converts a dialogue line to free text from an empty cue", () => {
    const s = make({ id: "X", kind: "line" }, "");
    const inCue = s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, "cue"))));
    expect(beat(inCue.apply(flipToFreeText(inCue)!)).kind).toBe("text");
  });
  it("converts from empty content-start too (e.g. just after an Enter-mirror), dropping the speaker", () => {
    const s = make({ id: "X", kind: "line", character: "ANNA" }, ""); // pre-filled speaker, empty content
    const inSay = s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, "say"))));
    const out = inSay.apply(flipToFreeText(inSay)!);
    expect(beat(out).kind).toBe("text");
    expect(beat(out).character).toBeUndefined(); // speaker dropped
  });

  it("the realistic sequence: Enter mirrors a dialogue line, then Space flips it to free text", () => {
    const s = make({ id: "X", kind: "line", character: "ANNA" }, "Hi");
    const atEnd = s.apply(s.tr.setSelection(TextSelection.create(s.doc, zonePos(s, "say") + 2))); // end of "Hi"
    let mirrored = atEnd; enter(atEnd, (tr) => { mirrored = atEnd.apply(tr); }); // caret in the new empty say
    const flipped = mirrored.apply(flipToFreeText(mirrored)!);
    const beats = (docToScene(flipped.doc).scene.blocks[0]!.children[0] as { beats: Array<{ kind: string; character?: string }> }).beats;
    expect(beats[1]).toMatchObject({ kind: "text" });
    expect(beats[1]!.character).toBeUndefined(); // speaker removed
  });
});

describe("promoteToDialogue (Tab at free-text start)", () => {
  it("promotes free text to dialogue with an empty cue", () => {
    const s = run(at(make({ id: "X", kind: "text" }, "hello"), "say", 0), promoteToDialogue);
    expect(beat(s).kind).toBe("line");
    expect(context(s).zone?.role).toBe("cue");
    expect(docToScene(s.doc).strings.X).toBe("hello"); // content preserved
  });
});
