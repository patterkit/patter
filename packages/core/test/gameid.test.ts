import { describe, it, expect } from "vitest";
import { gameIdify, isValidGameId, effectiveGameId } from "@patterkit/model";
import { validateProject } from "../src/validate.js";
import type { ProjectFile, Scene } from "@patterkit/model";

describe("gameIdify", () => {
  it("hyphen-slugs a name", () => {
    expect(gameIdify("The Tavern")).toBe("the-tavern");
    expect(gameIdify("It's a Trap!")).toBe("its-a-trap");
    expect(gameIdify("  Mixed--Up   Spaces ")).toBe("mixed-up-spaces");
    expect(gameIdify("Hello—World")).toBe("hello-world");
  });
});

describe("isValidGameId", () => {
  it("accepts lowercase / digits / inner hyphens", () => {
    expect(isValidGameId("the-tavern")).toBe(true);
    expect(isValidGameId("a")).toBe(true);
    expect(isValidGameId("scene2")).toBe(true);
  });
  it("rejects edges / caps / spaces", () => {
    expect(isValidGameId("-x")).toBe(false);
    expect(isValidGameId("x-")).toBe(false);
    expect(isValidGameId("The-Tavern")).toBe(false);
    expect(isValidGameId("a b")).toBe(false);
    expect(isValidGameId("")).toBe(false);
  });
});

describe("effectiveGameId", () => {
  it("uses the pinned gameId when present, else derives from the name", () => {
    expect(effectiveGameId({ name: "The Tavern" })).toBe("the-tavern");
    expect(effectiveGameId({ name: "The Tavern", gameId: "tavern" })).toBe("tavern");
    expect(effectiveGameId({ name: "X", gameId: "  " })).toBe("x"); // blank pin falls back
  });
});

// --- validation integration --------------------------------------------------

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
};
const scene = (id: string, name: string, gameId?: string, blocks: Scene["blocks"] = [{ id: `${id}_b`, type: "block", name: "B", children: [{ id: `${id}_s`, type: "snippet", beats: [{ id: `${id}_l`, kind: "line" }] }] }]): Scene =>
  ({ id, type: "scene", name, ...(gameId ? { gameId } : {}), blocks });

describe("validate: gameId", () => {
  it("flags an invalid pinned address", () => {
    const issues = validateProject({ project, scenes: [scene("s1", "One", "Not Valid")] });
    expect(issues.some((i) => i.code === "invalid-gameid" && i.id === "s1")).toBe(true);
  });

  it("flags two scenes that resolve to the same address", () => {
    // "The Tavern" and a pinned "the-tavern" collide.
    const issues = validateProject({ project, scenes: [scene("s1", "The Tavern"), scene("s2", "Other", "the-tavern")] });
    expect(issues.some((i) => i.code === "duplicate-gameid")).toBe(true);
  });

  it("flags two blocks in one scene with the same address (scene-scoped)", () => {
    const blocks: Scene["blocks"] = [
      { id: "b1", type: "block", name: "Intro", children: [{ id: "x1", type: "snippet", beats: [{ id: "l1", kind: "line" }] }] },
      { id: "b2", type: "block", name: "Other", gameId: "intro", children: [{ id: "x2", type: "snippet", beats: [{ id: "l2", kind: "line" }] }] },
    ];
    const issues = validateProject({ project, scenes: [scene("s1", "One", undefined, blocks)] });
    expect(issues.some((i) => i.code === "duplicate-gameid" && i.id === "b2")).toBe(true);
  });

  it("allows the same block address across different scenes (scene-scoped)", () => {
    const mk = (sid: string): Scene => scene(sid, sid, undefined, [{ id: `${sid}_intro`, type: "block", name: "Intro", children: [{ id: `${sid}_s`, type: "snippet", beats: [{ id: `${sid}_l`, kind: "line" }] }] }]);
    const issues = validateProject({ project, scenes: [mk("alpha"), mk("beta")] });
    expect(issues.some((i) => i.code === "duplicate-gameid")).toBe(false);
  });
});
