// ---------------------------------------------------------------------------
// Phase C: choice option editing (groups §8). insertOption appends an Option
// group; setGroupProps edits an option's choiceText / secretUntilEligible (the
// choice-surface). A choice's children are Option groups.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene, Group } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { insertChunk, insertOption, insertOptionAfter, setGroupProps, addOptionPrompt, seedSnippet } from "../src/groups.js";
import { context } from "../src/context.js";

/** A scene with one empty bubble, caret in its say (so insertChunk is allowed). */
function emptyBubbleState(): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }] }] }] };
  const doc = sceneToDoc(scene, { L1: "" });
  let sayPos = -1; doc.descendants((n, pos) => { if (n.type.name === "say") { sayPos = pos + 1; return false; } return true; });
  return EditorState.create({ doc, selection: TextSelection.create(doc, sayPos) });
}
function choicePos(s: EditorState): number {
  let p = -1; s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "group" && (JSON.parse(n.attrs.raw).selector === "choice")) p = pos; });
  return p;
}
function optionPos(s: EditorState, n: number): number {
  const cp = choicePos(s); const choice = s.doc.nodeAt(cp)!;
  let p = -1; let i = 0;
  choice.forEach((c, off) => { if (c.type.name === "group" && i++ === n) p = cp + 1 + off; });
  return p;
}
const choiceOf = (s: EditorState): Group => docToScene(s.doc).scene.blocks[0]!.children[0] as Group;

describe("choice option editing", () => {
  it("insertOption appends an Option group with a seeded bubble", () => {
    const s0 = emptyBubbleState();
    const s = s0.apply(insertChunk(s0, "choice")!); // a choice with one seeded option
    expect(choiceOf(s).children).toHaveLength(1);
    const out = s.apply(insertOption(s, choicePos(s))!);
    const choice = choiceOf(out);
    expect(choice.children).toHaveLength(2);
    expect((choice.children[1] as Group).type).toBe("group");          // the new option is an Option group
    expect((choice.children[1] as Group).children[0]!.type).toBe("snippet"); // ...with a bubble
    expect(context(out).zone?.role).toBe("cue");                       // dialogue content -> caret in the cue (cast popup opens)
  });

  it("setGroupProps edits an option's secret flag", () => {
    const s0 = emptyBubbleState();
    const s = s0.apply(insertChunk(s0, "choice")!);
    const secret = s.apply(setGroupProps(s, optionPos(s, 0), { secretUntilEligible: true })!);
    expect((choiceOf(secret).children[0] as Group).secretUntilEligible).toBe(true);
    const unsecret = secret.apply(setGroupProps(secret, optionPos(secret, 0), { secretUntilEligible: false })!);
    expect((choiceOf(unsecret).children[0] as Group).secretUntilEligible).toBeUndefined(); // false omits it
  });

  it("insertOptionAfter inserts a fresh option right after the given one", () => {
    const s0 = emptyBubbleState();
    const s = s0.apply(insertChunk(s0, "choice")!);          // choice with one option
    const firstId = (choiceOf(s).children[0] as Group).id;
    const out = s.apply(insertOptionAfter(s, optionPos(s, 0))!);
    const kids = choiceOf(out).children as Group[];
    expect(kids).toHaveLength(2);
    expect(kids[0]!.id).toBe(firstId);                       // original stays first
    expect(kids[1]!.type).toBe("group");                     // the fresh option follows it
    expect(context(out).zone?.role).toBe("cue");             // dialogue content -> caret in the cue (as insertOption)
  });

  it("insertOptionAfter refuses a non-option group (not a choice's child)", () => {
    const s0 = emptyBubbleState();
    const s = s0.apply(insertChunk(s0, "sequence")!);
    let seqPos = -1; s.doc.descendants((n, pos) => { if (seqPos < 0 && n.type.name === "group") seqPos = pos; });
    expect(insertOptionAfter(s, seqPos)).toBeNull();
  });

  it("insertOption refuses a non-choice group", () => {
    const s0 = emptyBubbleState();
    const s = s0.apply(insertChunk(s0, "sequence")!);
    let seqPos = -1; s.doc.descendants((n, pos) => { if (seqPos < 0 && n.type.name === "group") seqPos = pos; });
    expect(insertOption(s, seqPos)).toBeNull();
  });

  it("addOptionPrompt inserts a prompt into a prompt-less option, and no-ops when one exists", () => {
    // A choice whose option has content but NO prompt (the missing-prompt quick-fix target).
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "opt", type: "group", children: [{ id: "sn", type: "snippet", beats: [{ id: "L", kind: "line" }] }] },
      ] },
    ] }] };
    const s = EditorState.create({ doc: sceneToDoc(scene, { L: "" }) });
    expect((choiceOf(s).children[0] as Group).prompt).toBeUndefined(); // starts prompt-less
    const fixed = s.apply(addOptionPrompt(s, optionPos(s, 0))!);
    expect((choiceOf(fixed).children[0] as Group).prompt).toBeDefined(); // now has a prompt cell
    expect(addOptionPrompt(fixed, optionPos(fixed, 0))).toBeNull();      // idempotent - won't double up
  });

  it("seedSnippet seeds content into an option that has only its prompt (the ghost '+' after deleting the snippet)", () => {
    // An option group with a prompt but NO content snippet - the state after deleting the option's bubble.
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "opt", type: "group", prompt: { id: "P", kind: "text" }, children: [] }, // prompt only, no chunk
      ] },
    ] }] };
    const s = EditorState.create({ doc: sceneToDoc(scene, { P: "Pick me" }) });
    const opt = choiceOf(s).children[0] as Group;
    expect(opt.children).toHaveLength(0);          // no content snippet
    const seeded = s.apply(seedSnippet(s, optionPos(s, 0))!); // the ghost '+' click
    const opt2 = choiceOf(seeded).children[0] as Group;
    expect(opt2.children).toHaveLength(1);         // a fresh bubble was added (after the prompt)
    expect(opt2.children[0]!.type).toBe("snippet");
    expect(opt2.prompt).toBeDefined();             // the prompt is preserved
  });
});
