// ---------------------------------------------------------------------------
// The decisive invariant, in the zone model: a Patter scene (+ locale strings)
// round-trips through the zone-model ProseMirror document with stable ids and no
// data loss - character / direction in the cue / paren zones, content in the say
// zone, jump as a trailing node, an opaque group, an unmodeled field, and a
// real edit flowing back to the locale.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { canonicalStringify } from "@patterkit/core";
import type { Scene } from "@patterkit/model";
import { patterSchema } from "../src/schema.js";
import { sceneToDoc, docToScene } from "../src/bridge.js";

const scene: Scene = {
  id: "s1", type: "scene", name: "Tavern", blocks: [
    { id: "b1", type: "block", name: "Main", children: [
      { id: "n1", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA" },
        { id: "L2", kind: "line", character: "BO", direction: "weary" },          // direction -> paren zone
        { id: "L3", kind: "line", character: "ANNA", gameData: { vo: "take2" } },  // unmodeled field rides via raw
        { id: "T1", kind: "text" },
        { id: "A1", kind: "gameEvent", gameData: { emit: "doorSlam" } },             // no string
      ], jump: { to: "END" } },                                                  // jump -> trailing jumpLine
      { id: "n2", type: "snippet" },                                               // beat-less, jump-less: an UN-ENTERED bubble (click-to-add ghost)
      { id: "g1", type: "group", selector: "choice", children: [
        { id: "o1", type: "snippet", jump: { to: "END" } },
      ] },
    ] },
  ],
};
const strings = { L1: "Welcome, stranger.", L2: "Long road behind you?", L3: "Sit.", T1: "The fire crackles." };

const allIds = (s: Scene): string[] => {
  const ids: string[] = [];
  const walk = (n: { id?: string; blocks?: unknown[]; children?: unknown[]; beats?: unknown[] }) => {
    if (n.id) ids.push(n.id);
    [...(n.blocks ?? []), ...(n.children ?? []), ...(n.beats ?? [])].forEach((c) => walk(c as typeof n));
  };
  walk(s);
  return ids.sort();
};

describe("Patter scene <-> zone-model doc round-trip", () => {
  it("is lossless and id-stable (zones, jump, unmodeled fields, opaque group, strings)", () => {
    const back = docToScene(sceneToDoc(scene, strings));
    expect(canonicalStringify(back.scene)).toBe(canonicalStringify(scene));
    expect(back.strings).toEqual(strings);
    expect(allIds(back.scene)).toEqual(allIds(scene));
  });

  it("a real edit of a line's say zone flows back to the locale string, ids untouched", () => {
    const edited = setLineContent(sceneToDoc(scene, strings), "L1", "Get out.");
    const back = docToScene(edited);
    expect(back.strings.L1).toBe("Get out.");
    expect(back.strings.L2).toBe(strings.L2);
    expect(allIds(back.scene)).toEqual(allIds(scene));
    expect(canonicalStringify(back.scene)).toBe(canonicalStringify(scene)); // text lives in strings, flow unchanged
  });
});

/** Replace a line beat's say-zone content via a real transaction. */
function setLineContent(doc: PMNode, beatId: string, text: string): PMNode {
  let from = -1, to = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "line" && node.attrs.id === beatId) {
      node.forEach((z, offset) => {
        if (z.type.name === "say") { const sayPos = pos + 1 + offset; from = sayPos + 1; to = sayPos + 1 + z.content.size; }
      });
      return false;
    }
    return true;
  });
  const state = EditorState.create({ doc });
  return state.apply(state.tr.replaceWith(from, to, text.length > 0 ? patterSchema.text(text) : [])).doc;
}
