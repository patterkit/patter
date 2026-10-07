// A block (or scene) with no id or no name is a malformed node the validator must REPORT, not a crash.
// The editor surface could once leave such a block behind (a keyboard delete of a scene's only block),
// and `effectiveGameId` slugging the missing name threw a TypeError that took the whole validation, and
// every other problem it would have listed, down with it.

import { describe, it, expect } from "vitest";
import type { ProjectFile, Scene } from "@patterkit/model";
import { validateProject } from "../src/validate.js";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
};
const body = [{ id: "sn", type: "snippet" as const, beats: [{ id: "L1", kind: "line" as const }] }];

describe("validate: a nameless or id-less block", () => {
  it("reports a block with no name as missing-name instead of throwing", () => {
    const scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", children: body }] } as unknown as Scene;
    let issues: ReturnType<typeof validateProject> = [];
    expect(() => { issues = validateProject({ project, scenes: [scene] }); }).not.toThrow();
    expect(issues.some((i) => i.code === "missing-name" && i.id === "b")).toBe(true);
  });

  it("reports a block with neither id nor name (both codes) instead of throwing", () => {
    const scene = { id: "s", type: "scene", name: "S", blocks: [{ type: "block", children: body }] } as unknown as Scene;
    let issues: ReturnType<typeof validateProject> = [];
    expect(() => { issues = validateProject({ project, scenes: [scene] }); }).not.toThrow();
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("missing-id");
    expect(codes).toContain("missing-name");
  });

  it("reports a scene with no name instead of throwing", () => {
    const scene = { id: "s", type: "scene", blocks: [{ id: "b", type: "block", name: "B", children: body }] } as unknown as Scene;
    let issues: ReturnType<typeof validateProject> = [];
    expect(() => { issues = validateProject({ project, scenes: [scene] }); }).not.toThrow();
    expect(issues.some((i) => i.code === "missing-name" && i.id === "s")).toBe(true);
  });

  it("still derives an address from a pinned gameId on a nameless block", () => {
    const scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", gameId: "intro", children: body },
      { id: "b2", type: "block", name: "Intro", children: [{ id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line" }] }] },
    ] } as unknown as Scene;
    const issues = validateProject({ project, scenes: [scene] });
    expect(issues.some((i) => i.code === "duplicate-gameid" && i.id === "b2")).toBe(true);
  });
});
