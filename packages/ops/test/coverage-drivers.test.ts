// ---------------------------------------------------------------------------
// Coverage input drivers (#159 Phase 3): a beat gated on a host scope (`@world`)
// that nothing in the story writes is unreachable until a driver feeds the input.
// Covers: the unwritten-input hint, auto-proposed drivers, and driven coverage.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runCoverage, proposeCoverageDrivers } from "../src/index.js";

// L_intro → a choice → then a gate on @world.threat (>= 50 → L_high, else L_low).
// Nothing writes @world.threat, so without a driver L_high is unreachable.
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-cov-drivers-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "cd", name: "Coverage Drivers" },
    locales: { default: "en", all: ["en"] },
    start: { scene: "s1" },
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [
      { name: "threat", type: "number", default: 0 },
    ] }] },
  });

  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n0", type: "snippet", beats: [{ id: "L_intro", kind: "line", character: "A" }] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "oA", type: "group", prompt: { id: "CTa", kind: "text" },
            children: [{ id: "sA", type: "snippet", beats: [{ id: "L_a", kind: "line", character: "A" }] }] },
          { id: "oB", type: "group", prompt: { id: "CTb", kind: "text" },
            children: [{ id: "sB", type: "snippet", beats: [{ id: "L_b", kind: "line", character: "A" }] }] },
        ] },
        { id: "high", type: "snippet", condition: "@world.threat >= 50",
          beats: [{ id: "L_high", kind: "line", character: "A" }], jump: { to: "END" } },
        { id: "low", type: "snippet", beats: [{ id: "L_low", kind: "line", character: "A" }], jump: { to: "END" } },
      ] },
    ] } });

  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L_intro: "hi", L_a: "a", L_b: "b", L_high: "danger", L_low: "calm", CTa: "A", CTb: "B" } });

  return dir;
}

describe("coverage input drivers", () => {
  const loaded = loadProject(makeProject());
  const beat = (r: ReturnType<typeof runCoverage>, id: string) => r.beats.find((b) => b.id === id)!;

  it("flags an unwritten-input gate as needs-input rather than dead", () => {
    const report = runCoverage(loaded, { runs: 200, seed: 0 });
    expect(beat(report, "L_high").reachedRuns).toBe(0);
    expect(beat(report, "L_high").needsInput).toEqual(["@world.threat"]);
    expect(report.unwrittenInputs).toEqual(["@world.threat"]);
    // The unconditional branch is NOT flagged, it is reached, or dead for structural reasons.
    expect(beat(report, "L_low").needsInput).toBeUndefined();
  });

  it("auto-proposes a driver straddling the comparison literal", () => {
    expect(proposeCoverageDrivers(loaded)).toEqual([
      { ref: "@world.threat", kind: "recurring", cadence: "sometimes", values: [49, 50, 51] },
    ]);
  });

  it("a driver feeds the input so the gated beat is reached", () => {
    const drivers = proposeCoverageDrivers(loaded);
    const report = runCoverage(loaded, { runs: 200, seed: 0, drivers });
    expect(beat(report, "L_high").reachedRuns).toBeGreaterThan(0);
    expect(beat(report, "L_low").reachedRuns).toBeGreaterThan(0); // still sometimes calm
    expect(report.unwrittenInputs).toEqual([]);
    expect(beat(report, "L_high").needsInput).toBeUndefined();
    expect(report.drivers).toEqual(drivers);
  });

  it("stays bit-for-bit reproducible with drivers applied", () => {
    const drivers = proposeCoverageDrivers(loaded);
    const a = runCoverage(loaded, { runs: 200, seed: 7, drivers });
    const b = runCoverage(loaded, { runs: 200, seed: 7, drivers });
    expect(b).toEqual(a);
  });
});
