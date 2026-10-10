// ---------------------------------------------------------------------------
// Line padding (design/proposals/line-padding.md): a pause is a number of seconds in range, and a negative one
// is flagged where nothing certain follows to cut in with: a snippet's last line or text beat, and one followed
// by a game event. The runtime clamps both; validation says so where the writer sees it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Beat, ProjectFile, Scene } from "@patterkit/model";
import { validateProject } from "../src/validate.js";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile =>
  ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, cast: [{ name: "TAM" }], ...extra });
const scene = (beats: Beat[], padAfterDefault?: number): Scene => ({ id: "s", type: "scene", name: "S", blocks: [
  { id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats, ...(padAfterDefault !== undefined ? { padAfterDefault } : {}) }] },
] });
const codes = (p: ProjectFile, s: Scene): Array<[string, string | undefined, "warning" | undefined]> =>
  validateProject({ project: p, scenes: [s] }).filter((i) => i.code.includes("pad")).map((i) => [i.code, i.id, i.severity]);

describe("line padding validation", () => {
  it("accepts a cut-in mid-snippet, and pauses in range", () => {
    expect(codes(project({ padAfterDefault: 1 }), scene([
      { id: "L1", kind: "line", character: "TAM", padAfter: -0.5 },
      { id: "L2", kind: "line", character: "TAM", padAfter: 2 },
    ], 0.3))).toEqual([]);
  });

  it("refuses a pause out of range on a beat, a container, or the project", () => {
    expect(codes(project({ padAfterDefault: 61 }), scene([{ id: "L1", kind: "line", character: "TAM", padAfter: -11 }], 99))
      .filter(([code]) => code === "invalid-pad").map(([, id]) => id).sort())
      .toEqual(["L1", "sn", undefined].sort());
  });

  it("warns on a negative pause on a snippet's last line, and on one followed by a game event", () => {
    const issues = validateProject({ project: project(), scenes: [scene([
      { id: "L1", kind: "line", character: "TAM", padAfter: -0.4 },
      { id: "E1", kind: "gameEvent", gameData: { cue: "bell" } },
      { id: "T1", kind: "text", padAfter: -1 },
    ])] }).filter((i) => i.code === "pad-overlaps-seam");
    expect(issues.map((i) => [i.id, i.severity])).toEqual([["L1", "warning"], ["T1", "warning"]]);
    expect(issues[0]!.message).toMatch(/followed by a game event/);
    expect(issues[1]!.message).toMatch(/last line/);
  });
});
