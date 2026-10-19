// The runtime addresses scenes / blocks by their host-facing gameId (spec §6): a pinned gameId, or
// the name-slug fallback. openFlow accepts either the gameId or the internal id; sceneAddress /
// blockAddress give the inverse for a host that wants to display the address.

import { describe, it, expect } from "vitest";
import type { Bundle, CompiledScene } from "@patterkit/model";
import { Engine, resolveSceneRef, sceneAddressIndex } from "../src/index.js";

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

// Family parity item 1: one exported rule, so a tool that has to land where the game will (the Storylet
// Engine's pairing check, Show Card) cannot pick a different scene from the one openFlow opens.
describe("resolveSceneRef: the one scene rule, exported", () => {
  // Scene A's internal id is "harbour", which is also scene B's address.
  const a: CompiledScene = { id: "harbour", type: "scene", name: "Docks",
    blocks: [{ id: "blk_a", type: "block", name: "A", children: [{ id: "sn_a", type: "snippet", beats: [{ id: "l1", kind: "line" }] }] }] };
  const b: CompiledScene = { id: "scn_b", type: "scene", name: "Harbour",
    blocks: [{ id: "blk_b", type: "block", name: "B", children: [{ id: "sn_b", type: "snippet", beats: [{ id: "l2", kind: "line" }] }] }] };
  const scenes = { [a.id]: a, [b.id]: b };

  it("takes the address first: \"harbour\" is B's address, though it is A's id", () => {
    expect(resolveSceneRef(scenes, "harbour")).toBe("scn_b");
    expect(resolveSceneRef(scenes, "docks")).toBe("harbour");
  });

  it("falls back to the internal id, and is undefined for a name that is neither", () => {
    expect(resolveSceneRef(scenes, "scn_b")).toBe("scn_b");
    expect(resolveSceneRef(scenes, "nowhere")).toBeUndefined();
    expect(resolveSceneRef(scenes, "toString")).toBeUndefined();   // not a key a plain object inherits
  });

  it("is the rule openFlow plays by, so a tool and the game land in the same scene", () => {
    const eng = new Engine(bundle([a, b]));
    const r = eng.openFlow("main", { scene: "harbour" }).advance();
    expect(r.type === "line" && r.text).toBe("Cellar");   // l2: scene B's line
    expect(resolveSceneRef(scenes, "harbour", sceneAddressIndex(scenes))).toBe("scn_b");
  });
});
