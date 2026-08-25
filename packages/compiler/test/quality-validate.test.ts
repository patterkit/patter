// ---------------------------------------------------------------------------
// Quality validation at COMPILE time (expr 0.4.0 via buildSchema's `stages`): a stage name off the
// ladder is an error, not a condition that silently never matches - the hole Storylets found
// converting their first real deck, closed before the engine release. Patter surfaces it through
// validateConditions (runValidate's engine), the same road every expression issue travels.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { validateConditions } from "@patterkit/compiler";
import type { ProjectFile, Scene } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "q", name: "Q" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "negotiation", type: "quality", stages: ["not_started", "underway", "done"], shared: true }],
};

const sceneWith = (condition: string): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", condition, beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }],
});

describe("quality conditions validate against the ladder", () => {
  it("flags a stage name that is not on the ladder", () => {
    const issues = validateConditions({ project, scenes: [sceneWith('@negotiation >= "confrontation"')] });
    expect(issues.some((i) => i.severity === "error" && /stage/i.test(i.message))).toBe(true);
  });

  it("flags it on equality too, not just ordering", () => {
    const issues = validateConditions({ project, scenes: [sceneWith('@negotiation == "confrontation"')] });
    expect(issues.some((i) => i.severity === "error" && /stage/i.test(i.message))).toBe(true);
  });

  it("accepts a real stage, and advance() of a quality", () => {
    expect(validateConditions({ project, scenes: [sceneWith('@negotiation >= "underway"')] })).toEqual([]);
    expect(validateConditions({ project, scenes: [sceneWith('advance(@negotiation) == "done"')] })).toEqual([]);
  });

  it("refuses advance() of a non-quality", () => {
    const p2: ProjectFile = { ...project, properties: [{ name: "gold", type: "number", default: 0 }] };
    const issues = validateConditions({ project: p2, scenes: [sceneWith("advance(@gold) == 1")] });
    expect(issues.some((i) => i.severity === "error" && /quality/i.test(i.message))).toBe(true);
  });
});
