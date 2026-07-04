// ---------------------------------------------------------------------------
// Compile-time validation that a visits()/seen()/patter_* function's id resolves
// to a real node (scene / block / group / snippet) - the analogue of jump
// target validation, for the visit-count functions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { validateConditions } from "@patterkit/compiler";
import type { ProjectFile, Scene } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
};

const sceneWith = (condition: string): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", condition, beats: [{ id: "L", kind: "line" }], jump: { to: "END" } },
  ] }],
});

describe("visit-function id validation", () => {
  it("accepts ids that resolve to real nodes (scene / block / snippet)", () => {
    expect(validateConditions({ project, scenes: [sceneWith("seen('b') or visits('s') >= 1 and patter_seen('sn')")] })).toEqual([]);
  });

  it("flags an unknown node id", () => {
    const issues = validateConditions({ project, scenes: [sceneWith("seen('ghost')")] });
    expect(issues.some((i) => /unknown node id 'ghost'/.test(i.message))).toBe(true);
  });

  it("flags it for every visit-count function", () => {
    for (const fn of ["visits", "seen", "patter_visits", "patter_seen"]) {
      const issues = validateConditions({ project, scenes: [sceneWith(`${fn}('nope') ${fn === "visits" || fn === "patter_visits" ? ">= 1" : ""}`)] });
      expect(issues.some((i) => i.message.includes(`${fn}(): unknown node id 'nope'`))).toBe(true);
    }
  });
});
