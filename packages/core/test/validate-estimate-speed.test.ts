// ---------------------------------------------------------------------------
// The timing for lines without audio (design/proposals/speech-units-to-patterstage.md): a project's
// `estimateSpeed` is a speed from 0.5 to 2.5.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ProjectFile, Scene } from "@patterkit/model";
import { validateProject } from "../src/validate.js";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile =>
  ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, cast: [{ name: "TAM" }], ...extra });
const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
  { id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "TAM" }] }] },
] };
const speedIssues = (p: ProjectFile): string[] =>
  validateProject({ project: p, scenes: [scene] }).filter((i) => i.code === "invalid-estimate-speed").map((i) => i.message);

describe("the timing for lines without audio", () => {
  it("accepts no speed, and a speed from 0.5 to 2.5", () => {
    for (const speed of [undefined, 0.5, 1, 1.25, 2.5]) expect(speedIssues(project(speed === undefined ? {} : { estimateSpeed: speed }))).toEqual([]);
  });

  it("refuses a speed out of range, or not a number", () => {
    for (const speed of [0.4, 2.6, 0, -1, 4, Number.NaN, "fast" as unknown as number]) {
      expect(speedIssues(project({ estimateSpeed: speed }))).toHaveLength(1);
    }
  });
});
