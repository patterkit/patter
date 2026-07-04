// The discontiguous chunk-selection set plugin (src/multiselect): holds the selected chunk ids (set
// via the SET_MULTI meta), exposes their positions, and clears on any plain selection change / edit.

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { multiSelectState, multiSelectPositions, multiSelectIds, chunkPosById, SET_MULTI } from "../src/multiselect.js";

const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
  { id: "b", type: "block", name: "B", children: [
    { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line" }] },
    { id: "s2", type: "snippet", beats: [{ id: "L2", kind: "line" }] },
    { id: "s3", type: "snippet", beats: [{ id: "L3", kind: "line" }] },
  ] },
] };
const doc = sceneToDoc(scene, { L1: "a", L2: "b", L3: "c" });
const base = (): EditorState => EditorState.create({ doc, plugins: [multiSelectState()] });
const withSet = (ids: string[]): EditorState => { const s = base(); return s.apply(s.tr.setMeta(SET_MULTI, { ids, anchor: ids[0] ?? null })); };

describe("multiSelect state plugin", () => {
  it("a SET_MULTI meta records the discontiguous set; positions come back sorted", () => {
    const st = withSet(["s1", "s3"]); // a gap (s2 not selected)
    expect(multiSelectIds(st)).toEqual(["s1", "s3"]);
    expect(multiSelectPositions(st)).toEqual([chunkPosById(doc, "s1"), chunkPosById(doc, "s3")].sort((a, b) => a - b));
  });

  it("a set of fewer than two chunks yields no multi-select positions", () => {
    expect(multiSelectPositions(withSet(["s1"]))).toEqual([]);
  });

  it("a plain selection change clears the set (no stale multi-select behind a caret)", () => {
    const st = withSet(["s1", "s2"]);
    const moved = st.apply(st.tr.setSelection(TextSelection.create(st.doc, 1)));
    expect(multiSelectPositions(moved)).toEqual([]);
  });

  it("a null SET_MULTI meta clears it explicitly", () => {
    const st = withSet(["s1", "s2"]);
    const cleared = st.apply(st.tr.setMeta(SET_MULTI, null));
    expect(multiSelectIds(cleared)).toEqual([]);
  });
});
