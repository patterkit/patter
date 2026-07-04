// ---------------------------------------------------------------------------
// Z3: the character-zone accept (wholesale set) + suggestions, and the hint model.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { context } from "../src/context.js";
import { acceptCue, acceptCueForBeat, cueSuggestions } from "../src/cuezone.js";
import { hintsFor } from "../src/hints.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "M", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "AN" }] },
    ] },
  ],
};
const doc = sceneToDoc(scene, { L1: "" });

function zoneStart(beatId: string, role: string): { start: number; len: number } {
  let r: { start: number; len: number } | null = null;
  doc.descendants((node, pos) => {
    if (r) return false;
    if (node.type.name === "line" && node.attrs.id === beatId) {
      node.forEach((z, offset) => { if (z.type.name === role) r = { start: pos + 1 + offset + 1, len: z.content.size }; });
      return false;
    }
    return true;
  });
  return r!;
}
const caret = (role: string, offset = 0): EditorState =>
  EditorState.create({ doc, selection: TextSelection.create(doc, zoneStart("L1", role).start + offset) });

describe("acceptCue (popup pick / Tab accept)", () => {
  it("replaces the cue text with the accepted name and advances to content", () => {
    const tr = acceptCue(caret("cue", 2), "ANNA")!;
    const next = caret("cue", 2).apply(tr);
    const c = context(next);
    expect(c.zone?.role).toBe("say");
    // the line's character is now ANNA:
    expect(next.doc.textContent).toContain("ANNA");
  });

  it("acceptCueForBeat lands in content even when the caret has drifted out of the cue", () => {
    // Simulate the live-DOM drift: the caret is sitting in the SAY (or anywhere but the cue) when the
    // popup accepts. A caret-based accept would bail; the beat-based one still replaces + advances.
    const drifted = caret("say"); // caret NOT in the cue
    expect(acceptCue(drifted, "ANNA")).toBeNull(); // the old caret-based path gives up here
    const tr = acceptCueForBeat(drifted, "L1", "ANNA")!;
    const c = context(drifted.apply(tr));
    expect(c.zone?.role).toBe("say"); // landed in content
    expect(drifted.apply(tr).doc.textContent).toContain("ANNA"); // and set the speaker
  });
});

describe("cueSuggestions", () => {
  const cast = ["BARKEEP", "ANNA", "ANDREW", "BO"]; // recency order, not alphabetical
  it("filters by prefix, preserving order", () => {
    expect(cueSuggestions("an", cast)).toEqual(["ANNA", "ANDREW"]);
    expect(cueSuggestions("b", cast)).toEqual(["BARKEEP", "BO"]);
  });
  it("returns the whole cast (in order) for an empty prefix", () => {
    expect(cueSuggestions("", cast)).toEqual(cast);
  });
});

describe("hintsFor (cue + content states)", () => {
  it("offers type-to-filter / accept / free-text / direction / insert in the cue zone", () => {
    // L1's say is empty, so the "/" menu is reachable from the cue too.
    expect(hintsFor(context(caret("cue"))).map((h) => h.key)).toEqual(["type", "Enter", "Space", "(", "/"]);
  });
  it("offers line transitions in the (empty) content zone", () => {
    expect(hintsFor(context(caret("say"))).some((h) => h.key === "Enter")).toBe(true);
  });
});
