// ---------------------------------------------------------------------------
// Documentation routing + inheritance (spec §18): notes flow to an export
// CHANNEL by their class's `deliver`, untyped notes stay editor-only, and a
// class on a parent is inherited by the lines inside it, outermost-first.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
import { resolveDocumentation, classesForChannel } from "../src/index.js";
import type { LoadedProject } from "../src/index.js";

// One scene: snippet n1 with lines L1, L2; a choice group with option o1 (label CT1).
const SCENE = {
  id: "s1", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "Main", children: [
      { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }, { id: "L2", kind: "line", character: "B" }] },
      { id: "g1", type: "group", selector: "choice", children: [
        { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [{ id: "o1_c", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] },
  ],
};

const DOCS = {
  s1: [{ type: "everyone", text: "whole scene whispered" }],          // delivers to every channel
  n1: [{ type: "vo", text: "tense" }],                                // vo only
  L1: [{ type: "vo", text: "weary" }, { type: "writing", text: "internal" }, { type: "loc", text: "formal register" }],
  L2: [{ text: "untyped - editor only" }],                            // no class -> never exported
  CT1: [{ type: "loc", text: "keep it short" }],
};

const loaded = {
  project: { schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] } },
  scenes: [SCENE],
  authoring: [{ schema: "patter/authoring@0", documentation: DOCS }],
  locales: [], sceneFiles: {}, localeFiles: [], authoringFiles: [], root: "", projectFile: "",
} as unknown as LoadedProject;

const texts = (m: Map<string, { text: string }[]>, id: string) => (m.get(id) ?? []).map((l) => l.text);

describe("classesForChannel", () => {
  it("routes by deliver; '*' matches every channel", () => {
    expect(classesForChannel(DEFAULT_DOCUMENTATION_CLASSES, "vo")).toEqual(new Set(["everyone", "vo"]));
    expect(classesForChannel(DEFAULT_DOCUMENTATION_CLASSES, "loc")).toEqual(new Set(["everyone", "loc"]));
    expect(classesForChannel([{ name: "art", deliver: ["art"] }], "art")).toEqual(new Set(["art"]));
  });
});

describe("resolveDocumentation", () => {
  it("vo channel: inherits scene + snippet notes, outermost-first; excludes writing/loc", () => {
    const m = resolveDocumentation(loaded, "vo");
    expect(texts(m, "L1")).toEqual(["whole scene whispered", "tense", "weary"]);
    expect(texts(m, "L2")).toEqual(["whole scene whispered", "tense"]); // inherits only
  });

  it("loc channel: routes loc + everyone; vo/writing excluded", () => {
    const m = resolveDocumentation(loaded, "loc");
    expect(texts(m, "L1")).toEqual(["whole scene whispered", "formal register"]);
    expect(texts(m, "CT1")).toEqual(["whole scene whispered", "keep it short"]); // choice label, inherits scene
  });

  it("untyped notes are editor-only (never delivered to any channel)", () => {
    const vo = resolveDocumentation(loaded, "vo");
    const loc = resolveDocumentation(loaded, "loc");
    expect(texts(vo, "L2")).not.toContain("untyped - editor only");
    expect(texts(loc, "L2")).not.toContain("untyped - editor only");
  });

  it("a channel no class delivers to yields only the inherited everyone notes", () => {
    const m = resolveDocumentation(loaded, "sfx"); // no class routes to sfx except everyone
    expect(texts(m, "L1")).toEqual(["whole scene whispered"]);
  });
});
