// ---------------------------------------------------------------------------
// Z8: special-line insertion - jump (terminal, ends bubble) and game event (in
// place, bubble continues), plus deletion via the affordance.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { canInsertSpecial, insertJump, setSnippetJump, insertGameEvent, deleteAtomAt } from "../src/special.js";

function build(): EditorState {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "ANNA" },
          { id: "L2", kind: "line" }, // empty trailing line
        ] },
      ] },
    ],
  };
  return EditorState.create({ doc: sceneToDoc(scene, { L1: "Hello", L2: "" }) });
}
const atEmptyLine = (s: EditorState): EditorState => {
  let p = -1;
  s.doc.descendants((node, pos) => { if (p < 0 && node.type.name === "line" && node.attrs.id === "L2") { node.forEach((z, o) => { if (z.type.name === "cue") p = pos + 1 + o + 1; }); return false; } return true; });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, p)));
};
const snippets = (s: EditorState) => docToScene(s.doc).scene.blocks[0]!.children as unknown as Array<Record<string, unknown>>;
const beats = (snip: Record<string, unknown>) => (snip.beats ?? []) as Array<{ id: string; kind: string }>;

describe("canInsertSpecial", () => {
  it("is true at an empty line start", () => {
    expect(canInsertSpecial(atEmptyLine(build()))).toBe(true);
  });
});

describe("insertJump", () => {
  it("on the last line, sets the jump in place - no split, no fresh bubble", () => {
    const s0 = atEmptyLine(build());
    const s = s0.apply(insertJump(s0, "scn_next")!);
    const snips = snippets(s);
    expect(snips).toHaveLength(1);                               // the same snippet, no new bubble
    expect(beats(snips[0]!).map((b) => b.id)).toEqual(["L1"]);  // empty L2 consumed
    expect(snips[0]!.jump).toEqual({ to: "scn_next" });        // its terminal jump is set
    expect(context(s).beat?.id).toBe("L1");                      // caret eased to the last content beat (no popup)
  });

  it("SPLITS the bubble when jumping mid-snippet: trailing beats move to the follow-on", () => {
    // L1, [empty L2 - caret], L3: a jump is terminal, so L3 cannot stay after it - it moves down.
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [
            { id: "L1", kind: "line", character: "ANNA" },
            { id: "L2", kind: "line" }, // empty, caret here
            { id: "L3", kind: "line", character: "BO" },
          ] },
        ] },
      ],
    };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, { L1: "Hello", L2: "", L3: "Bye" }) });
    let p = -1;
    s0.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "line" && n.attrs.id === "L2") { n.forEach((z, o) => { if (z.type.name === "cue") p = pos + 1 + o + 1; }); return false; } return true; });
    const at = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, p)));
    const s = at.apply(insertJump(at, "scn_next")!);
    const snips = snippets(s);
    expect(snips).toHaveLength(2);
    expect(beats(snips[0]!).map((b) => b.id)).toEqual(["L1"]);   // before the jump
    expect(snips[0]!.jump).toEqual({ to: "scn_next" });         // terminal on the first half
    expect(beats(snips[1]!).map((b) => b.id)).toEqual(["L3"]);   // after -> follow-on snippet (empty L2 dropped)
    expect(snips[1]!.jump).toBeUndefined();
    expect(context(s).beat?.id).toBe("L3");                       // caret on the moved content
  });
});

describe("insertJump over an existing jump (replace vs split-and-inherit)", () => {
  const caretAt = (s0: EditorState, beatId: string): EditorState => {
    let p = -1;
    s0.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "line" && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === "cue") p = pos + 1 + o + 1; }); return false; } return true; });
    return s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, p)));
  };

  it("on the LAST line, REPLACES the snippet's existing jump", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "L2", kind: "line" }], jump: { to: "OLD" } },
      ] },
    ] };
    const at = caretAt(EditorState.create({ doc: sceneToDoc(scene, { L1: "Hi", L2: "" }) }), "L2");
    const s = at.apply(insertJump(at, "NEW")!);
    const snips = snippets(s);
    expect(snips).toHaveLength(1);                      // in place - no split, no new bubble
    expect(beats(snips[0]!).map((b) => b.id)).toEqual(["L1"]);
    expect(snips[0]!.jump).toEqual({ to: "NEW" });   // OLD replaced
  });

  it("MID-snippet, snippet A takes the NEW jump and split-away snippet B INHERITS the OLD jump", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "ANNA" },
          { id: "L2", kind: "line" }, // empty, caret here (not the last line)
          { id: "L3", kind: "line", character: "BO" },
        ], jump: { to: "OLD" } },
      ] },
    ] };
    const at = caretAt(EditorState.create({ doc: sceneToDoc(scene, { L1: "Hello", L2: "", L3: "Bye" }) }), "L2");
    const s = at.apply(insertJump(at, "NEW")!);
    const snips = snippets(s);
    expect(beats(snips[0]!).map((b) => b.id)).toEqual(["L1"]);
    expect(snips[0]!.jump).toEqual({ to: "NEW" });   // A: the newly entered jump
    expect(beats(snips[1]!).map((b) => b.id)).toEqual(["L3"]);
    expect(snips[1]!.jump).toEqual({ to: "OLD" });   // B: inherits the old jump
  });
});

describe("insertGameEvent", () => {
  it("inserts a game event and continues the bubble with a fresh line on the character selector", () => {
    const s0 = atEmptyLine(build());
    const s = s0.apply(insertGameEvent(s0)!);
    const snips = snippets(s);
    expect(snips).toHaveLength(1);
    const kinds = beats(snips[0]!).map((b) => b.kind);
    expect(kinds).toContain("gameEvent");
    expect(kinds[kinds.length - 1]).toBe("line"); // fresh trailing line
    expect(context(s).zone?.role).toBe("cue");    // caret on the character selector, like a new line
  });

  it("carries the current speaker onto the fresh line (selected, popup-ready)", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
        ] },
      ],
    };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, { L1: "" }) });
    let p = -1;
    s0.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "line" && n.attrs.id === "L1") { n.forEach((z, o) => { if (z.type.name === "cue") p = pos + 1 + o + 1; }); return false; } return true; });
    const at = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, p)));
    const s = at.apply(insertGameEvent(at)!);
    const kinds = beats(snippets(s)[0]!).map((b) => b.kind);
    expect(kinds).toEqual(["gameEvent", "line"]);
    const fresh = beats(snippets(s)[0]!)[1] as { character?: string };
    expect(fresh.character).toBe("ANNA");          // speaker carried onto the new line
    expect(context(s).zone?.role).toBe("cue");
    expect(s.selection.empty).toBe(false);         // whole name selected -> popup opens
  });
});

describe("setSnippetJump", () => {
  const firstSnippetPos = (s: EditorState, needJump = false): number => {
    let p = -1;
    s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && (!needJump || n.attrs.jump)) { p = pos; return false; } return true; });
    return p;
  };

  it("sets a jump on a snippet (the bottom-right chrome)", () => {
    const s0 = build();
    const s = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x")!);
    expect((snippets(s)[0] as { jump?: { to: string } }).jump).toEqual({ to: "scn_x" });
  });

  it("clears a snippet's jump (target null)", () => {
    const s0 = atEmptyLine(build());
    const withJump = s0.apply(insertJump(s0, "scn_next")!);
    const s = withJump.apply(setSnippetJump(withJump, firstSnippetPos(withJump, true), null)!);
    expect((snippets(s)[0] as { jump?: unknown }).jump).toBeUndefined();
  });

  it("collapses a WHOLLY-EMPTY bubble to a beat-less jump-only snippet when a jump is added", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }] }, // one empty placeholder beat
      ] },
    ] };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, {}) });
    const s = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x")!);
    const sn = snippets(s)[0] as { beats?: unknown[]; jump?: { to: string } };
    expect(sn.beats).toBeUndefined();         // the empty placeholder beat is gone -> a slim divert row
    expect(sn.jump).toEqual({ to: "scn_x" });
  });

  it("keeps the beats when the bubble has real text", () => {
    const s0 = build(); // L1 = "Hello" (ANNA) -> not empty
    const s = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x")!);
    expect(beats(snippets(s)[0]!).length).toBeGreaterThan(0);
  });

  it("sets a call jump (mode: call = jump-and-return)", () => {
    const s0 = build();
    const s = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x", "call")!);
    expect((snippets(s)[0] as { jump?: { to: string; mode?: string } }).jump).toEqual({ to: "scn_x", mode: "call" });
  });

  it("one-way is the default: mode 'jump' is omitted from the stored jump", () => {
    const s0 = build();
    const s = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x", "jump")!);
    expect((snippets(s)[0] as { jump?: Record<string, unknown> }).jump).toEqual({ to: "scn_x" });
  });

  it("re-targeting without a mode keeps the existing call mode", () => {
    const s0 = build();
    const call = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x", "call")!);
    const retargeted = call.apply(setSnippetJump(call, firstSnippetPos(call, true), "scn_y")!); // no mode arg
    expect((snippets(retargeted)[0] as { jump?: { to: string; mode?: string } }).jump).toEqual({ to: "scn_y", mode: "call" });
  });

  it("toggling a call jump back to go drops the mode", () => {
    const s0 = build();
    const call = s0.apply(setSnippetJump(s0, firstSnippetPos(s0), "scn_x", "call")!);
    const go = call.apply(setSnippetJump(call, firstSnippetPos(call, true), "scn_x", "jump")!);
    expect((snippets(go)[0] as { jump?: Record<string, unknown> }).jump).toEqual({ to: "scn_x" });
  });
});
