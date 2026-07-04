// ---------------------------------------------------------------------------
// Type-following injection (the cue-token work): a line injected when creating a
// snippet / group follows the KIND of the previous content beat in document order
// (text after text, dialogue after dialogue, default dialogue) - prevBeatKind. And
// an un-entered, beat-less bubble injects such a line on first click - seedBeatInSnippet.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { Scene, Snippet } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { prevBeatKind } from "../src/zoneutil.js";
import { seedBeatInSnippet, insertAfter, insertOption } from "../src/groups.js";
import { context } from "../src/context.js";
import type { Group } from "@patterkit/model";

/** block: [ snippet(text T1), snippet(line L1=ANNA), snippet n2 (beat-less) ]. */
function scene(): Scene {
  return { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "snT", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
    { id: "snL", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
    { id: "n2", type: "snippet" },
  ] }] };
}
const doc = (): PMNode => sceneToDoc(scene(), { T1: "narration", L1: "hi" });
const beatPos = (d: PMNode, id: string): number => { let p = -1; d.descendants((n, pos) => { if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === id) p = pos; return p < 0; }); return p; };
const snipPos = (d: PMNode, id: string): number => { let p = -1; d.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && (JSON.parse(n.attrs.raw) as { id?: string }).id === id) p = pos; return p < 0; }); return p; };
const blockChild = (s: EditorState, i: number): Snippet => docToScene(s.doc).scene.blocks[0]!.children[i] as Snippet;

describe("type-following injection", () => {
  it("prevBeatKind reads the nearest preceding content beat (default dialogue)", () => {
    const d = doc();
    expect(prevBeatKind(d, beatPos(d, "T1"))).toBe("line");  // nothing before -> default dialogue
    expect(prevBeatKind(d, beatPos(d, "L1"))).toBe("prose"); // a text line precedes
    expect(prevBeatKind(d, snipPos(d, "n2") + 1)).toBe("line"); // a dialogue line precedes
  });

  it("seedBeatInSnippet injects a type-following line into a beat-less bubble (dialogue -> cue)", () => {
    const state = EditorState.create({ doc: doc() });
    const out = state.apply(seedBeatInSnippet(state, snipPos(state.doc, "n2"))!);
    expect(blockChild(out, 2).beats).toHaveLength(1);
    expect(blockChild(out, 2).beats![0]!.kind).toBe("line"); // follows the preceding dialogue line
    expect(context(out).zone?.role).toBe("cue");             // dialogue -> caret in the cue (cast popup)
  });

  it("seedBeatInSnippet into an empty option content SKIPS the prompt (follows the dialogue flow, not the text prompt)", () => {
    // Dialogue before the choice; the option's prompt is text (the choice label). The ghost '+' inside
    // the option's empty content must follow the DIALOGUE flow, not the prompt's text kind.
    const sc: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn0", type: "snippet", beats: [{ id: "L0", kind: "line", character: "ANNA" }] },
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "opt", type: "group", prompt: { id: "P", kind: "text" }, children: [{ id: "snc", type: "snippet" }] },
      ] } as Group,
    ] }] };
    const state = EditorState.create({ doc: sceneToDoc(sc, { L0: "hi", P: "Pick me" }) });
    const out = state.apply(seedBeatInSnippet(state, snipPos(state.doc, "snc"))!);
    const option = (docToScene(out.doc).scene.blocks[0]!.children[1] as Group).children[0] as Group;
    const beat = (option.children[0] as { beats?: { kind: string }[] }).beats![0]!;
    expect(beat.kind).toBe("line"); // dialogue, NOT "text" (the prompt is skipped)
  });

  it("insertAfter a text line seeds a TEXT snippet, caret in its say (no popup)", () => {
    const state = EditorState.create({ doc: doc() });
    const out = state.apply(insertAfter(state, snipPos(state.doc, "snT"), "snippet")!);
    expect(blockChild(out, 1).beats![0]!.kind).toBe("text"); // the new snippet follows the text line
    expect(context(out).zone?.role).toBe("say");             // text -> caret in content, no cast popup
  });

  it("a new option's content follows the snippet BEFORE the choice, ignoring prompt and siblings", () => {
    // block: [ snippet(text TX), choice[ option(prompt text, content DIALOGUE) ] ]. The pre-choice
    // line is TEXT, the existing option's content is DIALOGUE, every prompt is text - so the new
    // option's content kind decides between "before the choice" (text) and "doc-order prev" (dialogue).
    const sc: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "snTX", type: "snippet", beats: [{ id: "TX", kind: "text" }] },
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "opt1", type: "group", prompt: { id: "P1", kind: "text" }, children: [
          { id: "c1", type: "snippet", beats: [{ id: "D1", kind: "line", character: "ANNA" }] },
        ] } as Group,
      ] },
    ] }] };
    const d = sceneToDoc(sc, { TX: "narration", P1: "go north", D1: "hi" });
    let choicePos = -1; d.descendants((n, pos) => { if (choicePos < 0 && n.type.name === "group" && (JSON.parse(n.attrs.raw) as { selector?: string }).selector === "choice") choicePos = pos; return choicePos < 0; });
    const state = EditorState.create({ doc: d });
    const out = state.apply(insertOption(state, choicePos)!);
    const choice = docToScene(out.doc).scene.blocks[0]!.children[1] as Group;
    const newOption = choice.children[1] as Group;
    expect((newOption.children[0] as { beats?: { kind: string }[] }).beats![0]!.kind).toBe("text"); // follows pre-choice TEXT line
    expect(context(out).zone?.role).toBe("say");  // text content -> caret in say, no cast popup
  });
});
