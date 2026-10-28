// ---------------------------------------------------------------------------
// Coverage and validate agree on content that can never run (the hands-on review, 2026-10; Q6): both read
// core's `neverRunNodes`, so a beat validate warns about (`unreachable-after-jump`) is one coverage never
// suggests an input for, and a beat behind a branch child with no condition is left alone the same way.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { validateProject } from "@patterkit/core";
import { loadProject, runCoverage } from "../src/index.js";

type Node = Record<string, unknown>;
const say = (id: string, extra: Node = {}): Node => ({ id, type: "snippet", beats: [{ id: `${id}_L`, kind: "line", character: "A" }], ...extra });

function project(nodes: Node[]): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-cov-never-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "nr", name: "Never runs" },
    locales: { default: "en", all: ["en"] }, cast: [{ name: "A" }], start: { scene: "s1" },
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "number", default: 0 }] }] },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [{ id: "b1", type: "block", name: "Main", children: nodes }],
  } });
  return dir;
}

describe("coverage reads the same never-runs walk as validate", () => {
  const loaded = loadProject(project([
    say("open"),
    { id: "br", type: "group", selector: "branch", children: [say("calm"), say("shadowed", { condition: "@world.threat >= 50" })] },
    say("live", { condition: "@world.threat >= 50" }),
    say("end", { jump: { to: "END" } }),
    say("after", { condition: "@world.threat >= 50" }),
  ]));
  const report = runCoverage(loaded, { runs: 100, seed: 3 });
  const beat = (id: string) => report.beats.find((b) => b.id === `${id}_L`)!;

  it("validate warns on the snippet after the END, and only that one", () => {
    const warned = validateProject({ project: loaded.project, scenes: loaded.scenes })
      .filter((i) => i.code === "unreachable-after-jump").map((i) => [i.id, i.jumper]);
    expect(warned).toEqual([["after", "end"]]);
  });

  it("never suggests an input for it, though it's gated on one nothing writes", () => {
    expect(beat("after").reachedRuns).toBe(0);
    expect(beat("after").needsInput).toBeUndefined();
    expect(beat("after").blockedBy).toBeUndefined();
  });

  it("keeps the branch child an unconditioned sibling always beats out of the hints, as before", () => {
    expect(beat("shadowed").reachedRuns).toBe(0);
    expect(beat("shadowed").needsInput).toBeUndefined();
  });

  it("still suggests the input for a gated beat that can run", () => {
    expect(beat("live").reachedRuns).toBe(0);
    expect(beat("live").needsInput).toEqual(["@world.threat"]);
    expect(report.unwrittenInputs).toEqual(["@world.threat"]);
  });
});
