// ---------------------------------------------------------------------------
// Phase C1: creating groups via the `/`-menu presets (groups §4). Each preset is
// the one model with selector / options pre-filled, seeded with an editable bubble
// the caret lands in. Driven on real EditorStates, read back via the bridge.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene, Group, Snippet } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { insertChunk, type GroupKind } from "../src/groups.js";

/** A scene whose one block holds a single empty bubble, caret in its (empty) say. */
function emptyBubbleState(): EditorState {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }] },
      ] },
    ],
  };
  const doc = sceneToDoc(scene, { L1: "" });
  let sayPos = -1;
  doc.descendants((n, pos) => { if (n.type.name === "say") { sayPos = pos + 1; return false; } return true; });
  return EditorState.create({ doc, selection: TextSelection.create(doc, sayPos) });
}

const create = (kind: GroupKind): EditorState => {
  const s = emptyBubbleState();
  const tr = insertChunk(s, kind);
  if (!tr) throw new Error("insertChunk returned null");
  return s.apply(tr);
};
const topGroup = (s: EditorState): Group => docToScene(s.doc).scene.blocks[0]!.children[0] as Group;

describe("insertChunk - `/`-menu presets", () => {
  it("Choice seeds a choice group with one Option group holding a bubble", () => {
    const s = create("choice");
    const g = topGroup(s);
    expect(g.type).toBe("group");
    expect(g.selector).toBe("choice");
    const option = g.children[0] as Group;
    expect(option.type).toBe("group");                 // option is an Option group (§8)
    expect(option.children[0]!.type).toBe("snippet");  // ...holding the seeded bubble (the prompt folds into the model's `prompt` field)
    // The caret lands in the option's PROMPT cell (the player-facing choice text, written first) - not
    // the cue, not the body line.
    let inPrompt = false;
    s.doc.descendants((n, pos) => {
      if (n.type.name === "optionprompt") { if (s.selection.from > pos && s.selection.from < pos + n.nodeSize) inPrompt = true; return false; }
      return true;
    });
    expect(inPrompt).toBe(true);
    expect(context(s).zone?.role).toBe("say"); // ...in the prompt's text, ready to type the choice label
  });

  it("Sequence / Cycle / Shuffle carry their order x exhaust", () => {
    expect(topGroup(create("sequence")).options).toEqual({ order: "sequential", exhaust: "once" });
    expect(topGroup(create("cycle")).options).toEqual({ order: "sequential", exhaust: "repeat" });
    expect(topGroup(create("shuffle")).options).toEqual({ order: "shuffle", exhaust: "repeat" });
    for (const k of ["sequence", "cycle", "shuffle"] as const) expect(topGroup(create(k)).selector).toBe("sequence");
  });

  it("If / Else seeds a branch group with a branch + an else", () => {
    const g = topGroup(create("if"));
    expect(g.selector).toBe("branch");
    expect(g.children).toHaveLength(2);
    expect((g.children[1] as Snippet).type).toBe("snippet");
    expect((g.children[1] as Snippet).beats).toBeUndefined(); // the else leaf is UN-ENTERED (beat-less): a click-to-add ghost
    expect(context(create("if")).zone?.role).toBe("cue");     // caret starts character entry on the FIRST leaf
  });

  it("carries the current line's speaker into the seeded bubble, caret on the cue", () => {
    // A line already naming a speaker: creating a group should keep you on the
    // character selector with that speaker carried forward (groups §4), not drop a
    // blank-speaker line with the caret in content.
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "B", children: [
          { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "BARKEEP" }] },
        ] },
      ],
    };
    const doc = sceneToDoc(scene, { L1: "" });
    let cuePos = -1;
    doc.descendants((n, pos) => { if (n.type.name === "cue") { cuePos = pos + 1; return false; } return true; });
    const start = EditorState.create({ doc, selection: TextSelection.create(doc, cuePos) });
    const tr = insertChunk(start, "sequence");
    if (!tr) throw new Error("insertChunk returned null");
    const s = start.apply(tr);
    // The current line isn't empty (it names a speaker), so the group lands as the
    // next sibling rather than replacing it.
    const group = docToScene(s.doc).scene.blocks[0]!.children.find((ch) => ch.type === "group") as Group;
    const seeded = group.children[0] as { beats: { character?: string }[] };
    expect(seeded.beats[0]!.character).toBe("BARKEEP");  // speaker carried into the seeded line
    const c = context(s);
    expect(c.zone?.role).toBe("cue");                    // ...and the caret is on it
    expect(s.selection.empty).toBe(false);               // whole speaker SELECTED (replace-ready)
  });

  it("drops the triggering empty line - no stray line left in the old snippet", () => {
    // A snippet with real content plus a trailing empty line (the one "/" was typed on):
    // the group lands as the next sibling and the empty line is consumed, not left behind.
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "B", children: [
          { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "L2", kind: "line" }] },
        ] },
      ],
    };
    const doc = sceneToDoc(scene, { L1: "Hi", L2: "" });
    let sayPos = -1; // the empty L2's say start
    doc.descendants((n, pos) => { if (n.type.name === "line" && n.attrs.id === "L2") { n.forEach((z, o) => { if (z.type.name === "say") sayPos = pos + 1 + o + 1; }); return false; } return true; });
    const start = EditorState.create({ doc, selection: TextSelection.create(doc, sayPos) });
    const s = start.apply(insertChunk(start, "choice")!);
    const kids = docToScene(s.doc).scene.blocks[0]!.children;
    expect(kids.map((c) => c.type)).toEqual(["snippet", "group"]); // original snippet + the new choice
    const beats = (kids[0] as { beats: { id: string }[] }).beats;
    expect(beats.map((b) => b.id)).toEqual(["L1"]);                // L2 (the triggering empty line) is gone
  });

  it("the created group round-trips losslessly", () => {
    const s = create("choice");
    const again = docToScene(sceneToDoc(docToScene(s.doc).scene, docToScene(s.doc).strings));
    expect(again.scene).toEqual(docToScene(s.doc).scene);
  });
});
