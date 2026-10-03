// gameData read helpers: sparse overrides resolve against field defaults (merge-at-read). And the
// engine's scene / block accessors, which hand back the raw overrides the way a beat's step does.

import { describe, it, expect } from "vitest";
import { Engine, gameDataFields, gameDataValue, effectiveGameData } from "../src/index.js";
import type { Bundle, GameDataField } from "@patterkit/model";

const bundle = (): Bundle => ({
  schema: "patter/bundle@0",
  content: { project: "p" },
  voiced: false,
  locales: { default: "en", included: ["en"] },
  gameDataFields: {
    scene: [{ name: "music", type: "text", default: "calm" }],
    line: [{ name: "emphasis", type: "boolean", default: false }, { name: "tone", type: "enum", values: ["warm", "cold"] }],
  },
  scenes: {},
  strings: {},
});

const lineFields: GameDataField[] = [
  { name: "emphasis", type: "boolean", default: false },
  { name: "tone", type: "enum", values: ["warm", "cold"] }, // no default
];

describe("gameData read helpers", () => {
  it("gameDataFields returns a node type's declared fields (empty when none)", () => {
    expect(gameDataFields(bundle(), "scene").map((f) => f.name)).toEqual(["music"]);
    expect(gameDataFields(bundle(), "gameEvent")).toEqual([]);
  });

  it("gameDataValue returns the override when set, else the default", () => {
    expect(gameDataValue(lineFields, { emphasis: true }, "emphasis")).toBe(true);   // override
    expect(gameDataValue(lineFields, undefined, "emphasis")).toBe(false);            // default
    expect(gameDataValue(lineFields, {}, "tone")).toBeUndefined();                   // no override, no default
  });

  it("treats a falsy override (e.g. boolean false) as a real value, not 'unset'", () => {
    expect(gameDataValue(lineFields, { emphasis: false }, "emphasis")).toBe(false);
  });

  it("effectiveGameData merges declared defaults + overrides, omitting value-less fields", () => {
    expect(effectiveGameData(lineFields, { tone: "warm" })).toEqual({ emphasis: false, tone: "warm" });
    expect(effectiveGameData(lineFields, undefined)).toEqual({ emphasis: false }); // tone has no value
  });

  it("keeps orphan override keys with no matching field", () => {
    expect(effectiveGameData(lineFields, { legacy: "x" })).toEqual({ emphasis: false, legacy: "x" });
  });
});

describe("scene and block gameData on the engine", () => {
  const withScenes = (): Bundle => ({
    ...bundle(),
    scenes: {
      s: { id: "s", type: "scene", name: "The Tavern", gameId: "tavern", gameData: { music: "jig", chapter: 2 },
        blocks: [
          { id: "b1", type: "block", name: "Cellar", gameData: { lit: false }, children: [
            { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
          ] },
          { id: "b2", type: "block", name: "Yard", gameData: {}, children: [] },
        ] },
      q: { id: "q", type: "scene", name: "Quiet", blocks: [{ id: "bq", type: "block", name: "Only", children: [] }] },
    },
    strings: { en: { T: "Dust." } },
  });
  const eng = new Engine(withScenes());

  it("returns the raw overrides by internal id or gameId address, defaults NOT merged", () => {
    expect(eng.gameDataForScene("s")).toEqual({ music: "jig", chapter: 2 });
    expect(eng.gameDataForScene("tavern")).toEqual({ music: "jig", chapter: 2 });
    expect(eng.gameDataForBlock("s", "b1")).toEqual({ lit: false });       // a falsy value is still a value
    expect(eng.gameDataForBlock("tavern", "cellar")).toEqual({ lit: false }); // name-slug block address
  });

  it("a block does not inherit its scene's gameData", () => {
    expect(eng.gameDataForBlock("s", "b2")).toEqual({});
  });

  it("is empty for a node with none and for refs that do not resolve", () => {
    expect(eng.gameDataForScene("q")).toEqual({});
    expect(eng.gameDataForBlock("q", "bq")).toEqual({});
    expect(eng.gameDataForScene("nope")).toEqual({});
    expect(eng.gameDataForBlock("s", "nope")).toEqual({});
  });

  it("hands out a copy, so a host cannot write into the bundle", () => {
    eng.gameDataForScene("s").music = "dirge";
    expect(eng.gameDataForScene("s")).toEqual({ music: "jig", chapter: 2 });
  });

  it("merges with the declared defaults through effectiveGameData", () => {
    const b = withScenes();
    expect(effectiveGameData(gameDataFields(b, "scene"), eng.gameDataForScene("q"))).toEqual({ music: "calm" });
  });

  it("getOutline carries scene / block gameData, omitted when empty", () => {
    const [s, q] = eng.getOutline();
    expect(s!.gameData).toEqual({ music: "jig", chapter: 2 });
    expect(s!.blocks[0]!.gameData).toEqual({ lit: false });
    expect("gameData" in s!.blocks[1]!).toBe(false); // an empty object is omitted
    expect("gameData" in q!).toBe(false);
    expect("gameData" in q!.blocks[0]!).toBe(false);
  });
});
