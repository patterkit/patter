// The runtime addresses scenes / blocks by their host-facing gameId (spec §6): a pinned gameId, or
// the name-slug fallback. openFlow accepts either the gameId or the internal id; sceneAddress /
// blockAddress give the inverse for a host that wants to display the address.

import { describe, it, expect } from "vitest";
import type { Bundle, CompiledScene } from "@patterkit/model";
import { Engine } from "../src/index.js";

function bundle(scenes: CompiledScene[]): Bundle {
  return {
    schema: "patter/bundle@0",
    content: { project: "P" },
    voiced: false,
    locales: { default: "en", included: ["en"] },
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s])),
    strings: { en: { l1: "Hello", l2: "Cellar" } },
  };
}

const tavern: CompiledScene = {
  id: "scn_abc", type: "scene", name: "The Tavern",
  blocks: [
    { id: "blk_intro", type: "block", name: "Intro", children: [{ id: "sn1", type: "snippet", beats: [{ id: "l1", kind: "line" }] }] },
    { id: "blk_cellar", type: "block", name: "Cellar", gameId: "the-cellar", children: [{ id: "sn2", type: "snippet", beats: [{ id: "l2", kind: "line" }] }] },
  ],
};

describe("runtime gameId addressing", () => {
  it("opens a flow by the scene's name-derived address", () => {
    const eng = new Engine(bundle([tavern]));
    const flow = eng.openFlow("main", { scene: "the-tavern" }); // name slug, not the internal id
    const r = flow.advance();
    expect(r.type).toBe("line");
  });

  it("starts at a block by its pinned gameId (scene-scoped)", () => {
    const eng = new Engine(bundle([tavern]));
    const flow = eng.openFlow("main", { scene: "the-tavern", block: "the-cellar" });
    const r = flow.advance();
    expect(r.type === "line" && r.text).toBe("Cellar");
  });

  it("still accepts the internal id (back-compat)", () => {
    const eng = new Engine(bundle([tavern]));
    const flow = eng.openFlow("main", { scene: "scn_abc", block: "blk_intro" });
    expect(flow.advance().type).toBe("line");
  });

  it("exposes the inverse address lookup", () => {
    const eng = new Engine(bundle([tavern]));
    expect(eng.sceneAddress("scn_abc")).toBe("the-tavern");   // derived from the name
    expect(eng.blockAddress("blk_cellar")).toBe("the-cellar"); // pinned
    expect(eng.blockAddress("blk_intro")).toBe("intro");       // derived
  });
});
