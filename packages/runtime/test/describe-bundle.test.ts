// describeBundle: the bundle inspector's runtime half. What a game may call, read off the compiled
// asset with no Engine, no state and nothing running.
//
// Two things these tests are really pinning. First, the ADDRESSES are the ones the runtime would
// actually resolve, derived exactly as `effectiveGameId` derives them - a list that merely looked
// plausible would send a writer hunting for a typo they never made. Second, the description is a
// STATIC read: constructing one must not require an Engine, which is checked here by never building
// one, and is the whole reason this is a bundle-level function.

import { describe, it, expect } from "vitest";
import type { Bundle, CompiledScene } from "@patterkit/model";
import { describeBundle } from "../src/index.js";

const scene: CompiledScene = {
  id: "s1", type: "scene", name: "The Tavern", // no gameId: the address is DERIVED from the name
  sceneProps: [{ name: "roundsBought", type: "number", default: 0 }],
  blocks: [
    { id: "b1", type: "block", name: "Arrival", gameId: "arrival", children: [
      { id: "sn1", type: "snippet", beats: [
        { id: "L1", kind: "text" },
        { id: "E1", kind: "gameEvent" },
      ] },
      { id: "g1", type: "group", children: [
        { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "Bartender" }] },
      ] },
    ] },
    { id: "b2", type: "block", name: "The Back Room", children: [ // derived address again
      { id: "sn3", type: "snippet", beats: [{ id: "L3", kind: "text" }] },
    ] },
  ],
};

function bundle(over: Partial<Bundle> = {}): Bundle {
  return {
    schema: "patter/bundle@0",
    content: { project: "Taverns", version: "3", hash: "aaaa", structureHash: "bbbb" },
    voiced: false,
    locales: { default: "en", included: ["en", "fr"] },
    scenes: { s1: scene },
    strings: { en: {}, fr: {} },
    ...over,
  };
}

describe("describeBundle", () => {
  it("reports the identity a save and a staleness check turn on", () => {
    const d = describeBundle(bundle());
    expect(d.identity).toMatchObject({
      schema: "patter/bundle@0", project: "Taverns", version: "3",
      hash: "aaaa", structureHash: "bbbb", defaultLocale: "en", locales: ["en", "fr"],
    });
  });

  it("defaults localisation to embedded, and flags a debug build as such", () => {
    // Absent means "embedded" (what a bundle written before the field relies on), and an inspector
    // must not read that absence as "ids" - it would report a shippable build as a broken one.
    expect(describeBundle(bundle()).identity.localisation).toBe("embedded");
    expect(describeBundle(bundle()).identity.sourceDebug).toBe(false);
    const dbg = describeBundle(bundle({ localisation: { mode: "ids", sourceDebug: true } }));
    expect(dbg.identity.localisation).toBe("ids");
    expect(dbg.identity.sourceDebug).toBe(true); // "not shippable", and worth saying loudly
  });

  it("lists the addresses game code may aim at, derived exactly as the runtime derives them", () => {
    const d = describeBundle(bundle());
    expect(d.addresses).toHaveLength(1);
    const [s] = d.addresses;
    expect(s!.gameId).toBe("the-tavern");     // from the NAME: no gameId was authored
    expect(s!.name).toBe("The Tavern");
    expect(s!.blocks.map((b) => b.gameId)).toEqual(["arrival", "the-back-room"]); // explicit, then derived
  });

  it("keeps block addresses nested under their scene, because the pair is the address", () => {
    // A block address is scene-scoped. Flattening them would invite calling a block address alone.
    const d = describeBundle(bundle());
    expect(Array.isArray(d.addresses[0]!.blocks)).toBe(true);
    expect(d).not.toHaveProperty("blocks");
  });

  it("separates what the HOST must supply from what the story owns", () => {
    const d = describeBundle(bundle({
      properties: [{ name: "chapter", type: "number", default: 1 }],
      scopeRegistry: { version: 1, scopes: [
        { token: "world", declarations: [
          { name: "weather", type: "string" },            // no default: the host MUST supply it
          { name: "isNight", type: "boolean", default: false },
        ] },
      ] },
    }));
    expect(d.hostScopes).toHaveLength(1);
    expect(d.hostScopes[0]!.token).toBe("world");
    expect(d.hostScopes[0]!.properties.map((p) => [p.name, p.hasDefault]))
      .toEqual([["weather", false], ["isNight", true]]);
    expect(d.properties.patter.map((p) => p.name)).toEqual(["chapter"]);
    expect(d.properties.scene).toEqual([
      { gameId: "the-tavern", properties: [{ name: "roundsBought", type: "number", hasDefault: true, default: 0, shared: false }] },
    ]);
  });

  it("resolves the sharing default per scope, rather than reporting it absent", () => {
    // Project-level declarations are shared, scene-local ones are per-flow, and neither states it in
    // the bundle. An inspector showing "shared: undefined" would push that rule onto the reader.
    const d = describeBundle(bundle({ properties: [{ name: "chapter", type: "number" }] }));
    expect(d.properties.patter[0]!.shared).toBe(true);
    expect(d.properties.scene[0]!.properties[0]!.shared).toBe(false);
  });

  it("marks a scope with no declarations as opaque rather than as empty", () => {
    // "Any name, unchecked" is a different host contract from "no properties", and the difference is
    // exactly what an integrator is reading this section to learn.
    const d = describeBundle(bundle({ scopeRegistry: { version: 1, scopes: [{ token: "world" }] } }));
    expect(d.hostScopes[0]!.opaque).toBe(true);
    expect(d.hostScopes[0]!.properties).toEqual([]);
    const closed = describeBundle(bundle({ scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [] }] } }));
    expect(closed.hostScopes[0]!.opaque).toBe(false);
  });

  it("reports the gameData surface host code switches on, enum values included", () => {
    const d = describeBundle(bundle({ gameDataFields: {
      gameEvent: [{ name: "event", type: "enum", values: ["door_open", "alarm"], purpose: "what to fire" }],
      line: [],           // declared but empty: nothing to show, so no row
    } }));
    expect(d.gameData.map((g) => g.kind)).toEqual(["gameEvent"]);
    expect(d.gameData[0]!.fields[0]).toEqual({
      name: "event", type: "enum", hasDefault: false,
      values: ["door_open", "alarm"], purpose: "what to fire",
    });
  });

  it("counts the tree in one walk, game-event beats separately", () => {
    const d = describeBundle(bundle());
    expect(d.counts).toEqual({
      scenes: 1, blocks: 2, groups: 1, snippets: 3, beats: 4, prompts: 0, gameEvents: 1, cast: 0,
    });
  });

  it("counts choice prompts, which live on the group and are not snippet beats", () => {
    // A prompt is a beat the author wrote, but it hangs off the group rather than sitting in a
    // snippet, so the beat walk never sees it. Left out entirely, a heavily branching script would
    // report a handful of beats and read as the wrong build.
    const withChoice = describeBundle(bundle({ scenes: { s1: { ...scene, blocks: [
      { id: "b1", type: "block", name: "Choose", children: [
        { id: "c", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [
            { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }] },
          ] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, children: [] },
        ] },
      ] },
    ] } } }));
    expect(withChoice.counts.prompts).toBe(2);
    expect(withChoice.counts.beats).toBe(1); // unchanged: still the getBeatSequence population
  });

  it("survives a minimal bundle with none of the optional sections", () => {
    const bare = describeBundle({
      schema: "patter/bundle@0", content: { project: "P" }, voiced: false,
      locales: { default: "en", included: ["en"] }, scenes: {}, strings: {},
    });
    expect(bare.addresses).toEqual([]);
    expect(bare.hostScopes).toEqual([]);
    expect(bare.properties).toEqual({ patter: [], scene: [] });
    expect(bare.gameData).toEqual([]);
    expect(bare.counts.scenes).toBe(0);
    expect(bare.identity.version).toBeUndefined();
  });
});
