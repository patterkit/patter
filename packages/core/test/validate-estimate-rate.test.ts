// ---------------------------------------------------------------------------
// The timing for lines without audio (design/proposals/syllable-counter.md): a project's
// `estimateSyllablesPerSecond` is a number of syllables a second from 2 to 10.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ProjectFile, Scene } from "@patterkit/model";
import { validateProject } from "../src/validate.js";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile =>
  ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, cast: [{ name: "TAM" }], ...extra });
const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
  { id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "TAM" }] }] },
] };
const rateIssues = (p: ProjectFile): string[] =>
  validateProject({ project: p, scenes: [scene] }).filter((i) => i.code === "invalid-estimate-rate").map((i) => i.message);

describe("the timing for lines without audio", () => {
  it("accepts no rate, and a rate from 2 to 10", () => {
    for (const rate of [undefined, 2, 4.5, 10]) expect(rateIssues(project(rate === undefined ? {} : { estimateSyllablesPerSecond: rate }))).toEqual([]);
  });

  it("refuses a rate out of range, or not a number", () => {
    for (const rate of [1.9, 10.1, 0, -5, Number.NaN, "fast" as unknown as number]) {
      expect(rateIssues(project({ estimateSyllablesPerSecond: rate }))).toHaveLength(1);
    }
  });
});
