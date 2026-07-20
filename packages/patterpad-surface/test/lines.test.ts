// ---------------------------------------------------------------------------
// Z5: line creation + mirroring + bubble boundaries. Driven on real EditorStates,
// read back via the bridge.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { enter, endBubble, prependLine } from "../src/lines.js";

function build(): EditorState {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [
        { id: "sn", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "ANNA" },
          { id: "L2", kind: "line", character: "ANNA" },
        ], jump: { to: "END" } },
      ] },
    ],
  };
  return EditorState.create({ doc: sceneToDoc(scene, { L1: "Hello", L2: "" }) });
}
const sayStart = (state: EditorState, beatId: string): number => {
  let p = -1;
  state.doc.descendants((node, pos) => {
    if (p >= 0) return false;
    if ((node.type.name === "line" || node.type.name === "prose") && node.attrs.id === beatId) {
      node.forEach((z, o) => { if (z.type.name === "say") p = pos + 1 + o + 1; });
      return false;
    }
    return true;
  });
  return p;
};
const caretInSay = (state: EditorState, beatId: string, offset = 0): EditorState =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, sayStart(state, beatId) + offset)));
const run = (state: EditorState, cmd: Command): EditorState => {
  let next = state;
  cmd(state, (tr) => { next = state.apply(tr); });
  return next;
};
const snippets = (state: EditorState) => state.doc.type === undefined ? [] :
  (docToScene(state.doc).scene.blocks[0]!.children as unknown as Array<Record<string, unknown>>);
const beatsOf = (snip: Record<string, unknown>) => (snip.beats ?? []) as Array<{ id: string; kind: string; character?: string }>;

describe("ending a bubble never copies the snippet's authored logic", () => {
  /** A conditioned, tagged snippet carrying host data - everything that must stay on the FIRST half. */
  function conditioned(): EditorState {
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", condition: "@hp > 5", tags: ["combat"], gameData: { mood: "tense" }, beats: [
            { id: "L1", kind: "line", character: "ANNA" },
            { id: "L2", kind: "line", character: "ANNA" },
          ] },
        ] },
      ],
    };
    return EditorState.create({ doc: sceneToDoc(scene, { L1: "Hello", L2: "" }) });
  }

  it("gives the NEW bubble a clean snippet - the condition stays on the original", () => {
    const s = run(caretInSay(conditioned(), "L1", 5), endBubble); // Shift-Enter at the end of "Hello"
    const snips = snippets(s);
    expect(snips).toHaveLength(2);
    const [a, b] = snips as Array<Record<string, unknown>>;

    // The original keeps what the author put on it...
    expect(a!.condition).toBe("@hp > 5");
    expect(a!.tags).toEqual(["combat"]);

    // ...and the new bubble inherits none of it: a copied condition would silently re-gate the new
    // lines, and copied effects / host data would ride along unnoticed.
    expect(b!.condition).toBeUndefined();
    expect(b!.tags).toBeUndefined();
    expect(b!.gameData).toBeUndefined();
    expect(b!.id).not.toBe(a!.id);                    // ...on a fresh id
    expect(beatsOf(b!).map((x) => x.id)).toEqual(["L2"]); // only the BEATS moved down
  });
});

describe("Enter - continuation (content present)", () => {
  it("adds a mirrored line with the speaker pre-filled and SELECTED in the cue", () => {
    const s = run(caretInSay(build(), "L1", 5), enter); // end of "Hello"
    const snips = snippets(s);
    expect(snips).toHaveLength(1);
    const beats = beatsOf(snips[0]!);
    expect(beats).toHaveLength(3);
    expect(beats[1]!.character).toBe("ANNA");          // the new mirrored line
    expect(context(s).zone?.role).toBe("cue");         // cursor lands in the cue
    expect(s.selection.empty).toBe(false);             // the name is selected (type to replace)
  });

  it("Enter on an empty line does NOT end the bubble (only Shift-Enter does)", () => {
    const s = run(caretInSay(build(), "L2", 0), enter); // L2 is empty
    expect(snippets(s)).toHaveLength(1);                 // still one bubble
    expect(beatsOf(snippets(s)[0]!).length).toBe(3);    // L1, L2, + a new mirrored line
  });
});

describe("Enter - mid-content split", () => {
  const sayText = (state: EditorState, beatId: string): string => {
    let t = "";
    state.doc.descendants((node) => {
      if (t) return false;
      if ((node.type.name === "line" || node.type.name === "prose") && node.attrs.id === beatId) {
        node.forEach((z) => { if (z.type.name === "say") t = z.textContent; });
        return false;
      }
      return true;
    });
    return t;
  };

  it("splits a dialogue line, keeping the speaker, caret at the new content start (no popup)", () => {
    const s = run(caretInSay(build(), "L1", 2), enter); // "He|llo"
    const snips = snippets(s);
    expect(snips).toHaveLength(1);
    const beats = beatsOf(snips[0]!);
    expect(beats).toHaveLength(3);                    // L1, new line, L2
    expect(sayText(s, "L1")).toBe("He");              // head stays
    expect(beats[1]!.kind).toBe("line");
    expect(beats[1]!.character).toBe("ANNA");         // same speaker, pre-filled
    expect(context(s).zone?.role).toBe("say");        // caret in content, NOT the cue
    expect(context(s).zone?.atStart).toBe(true);
    expect(sayText(s, beats[1]!.id)).toBe("llo");     // tail moved down
    expect(s.selection.empty).toBe(true);             // nothing selected (no popup)
  });

  it("splits a free-text line into a new text line, caret at the new content start", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [{ id: "P1", kind: "text" }] },
        ] },
      ],
    };
    const st = EditorState.create({ doc: sceneToDoc(scene, { P1: "abcd" }) });
    const s = run(caretInSay(st, "P1", 2), enter); // "ab|cd"
    const beats = beatsOf(snippets(s)[0]!);
    expect(beats).toHaveLength(2);
    expect(beats[0]!.kind).toBe("text");
    expect(beats[1]!.kind).toBe("text");
    expect(sayText(s, "P1")).toBe("ab");
    expect(sayText(s, beats[1]!.id)).toBe("cd");
    expect(context(s).zone?.role).toBe("say");
    expect(context(s).zone?.atStart).toBe(true);
  });
});

describe("Shift/Cmd-Enter - end bubble now (with content)", () => {
  it("splits after the current line into a fresh bubble with a mirrored line", () => {
    const s = run(caretInSay(build(), "L1", 5), endBubble); // end of "Hello" (L1)
    const snips = snippets(s);
    expect(snips).toHaveLength(2);
    expect(beatsOf(snips[0]!).map((b) => b.id)).toEqual(["L1"]);
    // bubble B holds the following beat L2 (no fresh line needed)
    expect(beatsOf(snips[1]!)[0]!.id).toBe("L2");
    expect(context(s).beat?.id).toBe("L2");
  });

  it("at the last line, the fresh bubble lands in the cue with the name selected (like a new line)", () => {
    const s = run(caretInSay(build(), "L2", 0), endBubble); // L2 is the last beat
    expect(snippets(s)).toHaveLength(2);
    expect(context(s).zone?.role).toBe("cue"); // not the content area
    expect(s.selection.empty).toBe(false);     // speaker selected, popup will open
  });

  it("a split moves the snippet's jump to the SECOND bubble, not the first", () => {
    // build()'s snippet carries jump { to: "END" }; splitting after L1 must hand the
    // terminal jump to the new tail bubble (B), clearing it on the head (A).
    const s = run(caretInSay(build(), "L1", 5), endBubble);
    const snips = snippets(s);
    expect((snips[0] as { jump?: unknown }).jump).toBeUndefined();          // head loses it
    expect((snips[1] as { jump?: { to: string } }).jump).toEqual({ to: "END" }); // moved to the tail
  });

  it("ends the bubble correctly INSIDE a group (snippets nest in groups too)", () => {
    // Regression: endBubble's split helper used to skip group children, so it left a
    // blank sibling snippet and stranded the caret. It must split the snippet within
    // the group and land on the fresh bubble.
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "g", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "repeat" }, children: [
            { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
          ] },
        ] },
      ],
    };
    const st = EditorState.create({ doc: sceneToDoc(scene, { L1: "Hello" }) });
    const s = run(caretInSay(st, "L1", 5), endBubble); // end of "Hello"
    const group = docToScene(s.doc).scene.blocks[0]!.children[0] as { children: Array<{ beats?: unknown[] }> };
    expect(group.children).toHaveLength(2);          // two bubbles now, both inside the group
    expect(context(s).zone?.role).toBe("cue");       // caret landed on the fresh bubble's cue
    expect(s.selection.empty).toBe(false);           // speaker selected (a real landing, not stranded)
  });
});

describe("prependLine - the hover '+' (add a line above the first beat)", () => {
  const snippetPos = (state: EditorState, id: string): number => {
    let p = -1;
    state.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && (JSON.parse(n.attrs.raw).id ?? null) === id) { p = pos; return false; } return true; });
    return p;
  };

  it("inserts a fresh line above the first beat, carrying the speaker, caret in the cue", () => {
    const s0 = build(); // snippet "sn": L1 ANNA, L2 ANNA, jump END
    const tr = prependLine(s0, snippetPos(s0, "sn"));
    expect(tr).not.toBeNull();
    const s = s0.apply(tr!);
    const beats = beatsOf(snippets(s)[0]!);
    expect(beats[0]!.kind).toBe("line");
    expect(beats[0]!.character).toBe("ANNA");         // carried from the first dialogue line
    expect(beats[1]!.id).toBe("L1");                  // ...and sits ABOVE the old first beat
    expect(context(s).zone?.role).toBe("cue");        // caret on the character selector
    expect(s.selection.empty).toBe(false);            // speaker selected (replace-ready)
  });

  it("adds a line to a snippet that holds only a jump (no other way in)", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [], jump: { to: "END" } },
        ] },
      ],
    };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, {}) });
    const tr = prependLine(s0, snippetPos(s0, "sn"));
    expect(tr).not.toBeNull();
    const s = s0.apply(tr!);
    const snip = snippets(s)[0]!;
    expect(beatsOf(snip)[0]!.kind).toBe("line");      // a line now precedes...
    expect((snip.jump as { to: string }).to).toBe("END"); // ...the still-terminal jump
    expect(context(s).zone?.role).toBe("cue");        // caret lands in the (empty) cue
  });
});
