// Author tags (#215): a beat's accumulated tags are the union of its own and every ancestor's
// (scene -> block -> group(s) -> snippet -> beat), deduped, outermost-first. Delivered steps carry them,
// and the engine exposes tagsForBeat / tagsForScene / tagsForBlock accessors.

import { describe, it, expect } from "vitest";
import type { Bundle, CompiledScene } from "@patterkit/model";
import { Engine, buildTagIndex } from "../src/index.js";

const scene: CompiledScene = {
  id: "s", type: "scene", name: "S", tags: ["chapter1"],
  blocks: [{ id: "b", type: "block", name: "B", tags: ["hub"], children: [
    { id: "sn1", type: "snippet", tags: ["intro"], beats: [
      { id: "L1", kind: "text", tags: ["barked"] },
      { id: "L2", kind: "text" },
    ] },
    { id: "g", type: "group", tags: ["combat", "chapter1"], children: [ // dup chapter1 collapses
      { id: "sn2", type: "snippet", beats: [{ id: "L3", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
};

function bundle(scenes: CompiledScene[] = [scene]): Bundle {
  return {
    schema: "patter/bundle@0",
    content: { project: "P" },
    voiced: false,
    locales: { default: "en", included: ["en"] },
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s])),
    strings: { en: { L1: "Intro.", L2: "More.", L3: "Fight!" } },
  };
}

describe("buildTagIndex", () => {
  it("accumulates ancestor tags, deduped, outermost-first", () => {
    const idx = buildTagIndex(bundle());
    expect(idx.get("s")).toEqual(["chapter1"]);
    expect(idx.get("b")).toEqual(["chapter1", "hub"]);
    expect(idx.get("sn1")).toEqual(["chapter1", "hub", "intro"]);
    expect(idx.get("L1")).toEqual(["chapter1", "hub", "intro", "barked"]);
    expect(idx.get("L2")).toEqual(["chapter1", "hub", "intro"]);
    expect(idx.get("g")).toEqual(["chapter1", "hub", "combat"]); // dup collapsed
    expect(idx.get("L3")).toEqual(["chapter1", "hub", "combat"]);
  });

  it("yields no entry for an unknown id", () => {
    expect(buildTagIndex(bundle()).get("nope")).toBeUndefined();
  });
});

describe("delivered steps carry accumulated tags", () => {
  it("each beat's step has its accumulated tags; none-case omits the key", () => {
    const untagged: CompiledScene = {
      id: "s2", type: "scene", name: "S2",
      blocks: [{ id: "b2", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
      ] }],
    };
    const eng = new Engine(bundle([scene, untagged]));
    const flow = eng.openFlow("main", { scene: "s" });
    const s1 = flow.advance();
    expect(s1.type === "text" && s1.tags).toEqual(["chapter1", "hub", "intro", "barked"]);
    const s2 = flow.advance();
    expect(s2.type === "text" && s2.tags).toEqual(["chapter1", "hub", "intro"]);
    const s3 = flow.advance();
    expect(s3.type === "text" && s3.tags).toEqual(["chapter1", "hub", "combat"]);

    // A beat with no tags anywhere up the chain omits the key entirely.
    const plain = eng.openFlow("p", { scene: "s2" });
    const r = plain.advance();
    expect(r.type).toBe("text");
    expect("tags" in r).toBe(false);
  });
});

describe("engine tag accessors", () => {
  const eng = new Engine(bundle());
  it("tagsForBeat returns the accumulated tags", () => {
    expect(eng.tagsForBeat("L1")).toEqual(["chapter1", "hub", "intro", "barked"]);
    expect(eng.tagsForBeat("L3")).toEqual(["chapter1", "hub", "combat"]);
  });
  it("tagsForScene returns the scene's own tags", () => {
    expect(eng.tagsForScene("s")).toEqual(["chapter1"]);
  });
  it("tagsForBlock returns scene + block accumulated", () => {
    expect(eng.tagsForBlock("s", "b")).toEqual(["chapter1", "hub"]);
  });
  it("returns an empty array for unknown refs", () => {
    expect(eng.tagsForBeat("nope")).toEqual([]);
    expect(eng.tagsForScene("nope")).toEqual([]);
    expect(eng.tagsForBlock("s", "nope")).toEqual([]);
  });
});
