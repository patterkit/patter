// gameData read helpers: sparse overrides resolve against field defaults (merge-at-read).

import { describe, it, expect } from "vitest";
import { gameDataFields, gameDataValue, effectiveGameData } from "../src/index.js";
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
