// ---------------------------------------------------------------------------
// Narrative coverage (#159): random playthroughs tally which beats get reached,
// flag never-reached (dead) content, and stay bit-for-bit reproducible per seed.
// Also covers resolveStart (the project entry point used by play + coverage).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runCoverage, resolveStart } from "../src/index.js";

// A tiny branching story: L1 always plays, then a choice routes to L2 OR L3,
// then a jump to END, so L4 (a snippet AFTER the END jump) is unreachable.
function makeProject(withStart = false): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-coverage-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "cov", name: "Coverage Game" },
    locales: { default: "en", all: ["en"] },
    ...(withStart ? { start: { scene: "s1" } } : {}),
  });

  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "oA", type: "group", prompt: { id: "CTa", kind: "text" },
            children: [{ id: "oA1", type: "snippet", beats: [{ id: "L2", kind: "line", character: "A" }] }] },
          { id: "oB", type: "group", prompt: { id: "CTb", kind: "text" },
            children: [{ id: "oB1", type: "snippet", beats: [{ id: "L3", kind: "line", character: "A" }] }] },
        ] },
        { id: "nEnd", type: "snippet", jump: { to: "END" } },
        { id: "nDead", type: "snippet", beats: [{ id: "L4", kind: "line", character: "A" }] }, // unreachable
      ] },
    ] } });

  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L1: "one", L2: "two", L3: "three", L4: "dead", CTa: "go A", CTb: "go B" } });

  return dir;
}

describe("runCoverage", () => {
  const loaded = loadProject(makeProject());
  const report = runCoverage(loaded, { runs: 200, seed: 0 });
  const beat = (id: string) => report.beats.find((b) => b.id === id)!;

  it("tallies only the four content beats (choice prompts excluded)", () => {
    expect(report.beats.map((b) => b.id).sort()).toEqual(["L1", "L2", "L3", "L4"]);
  });

  it("reaches the always-played line in every run", () => {
    expect(beat("L1").reachedRuns).toBe(200);
    expect(beat("L1").reachPct).toBe(100);
  });

  it("splits the two branches across runs (each run takes exactly one)", () => {
    expect(beat("L2").reachedRuns + beat("L3").reachedRuns).toBe(200);
    expect(beat("L2").reachedRuns).toBeGreaterThan(0);
    expect(beat("L3").reachedRuns).toBeGreaterThan(0);
  });

  it("flags the unreachable beat as never reached (0%)", () => {
    expect(beat("L4").reachedRuns).toBe(0);
    expect(beat("L4").reachPct).toBe(0);
  });

  it("summarises totals + termination", () => {
    expect(report.totals).toMatchObject({ beats: 4, covered: 3, neverHit: 1 });
    expect(report.totals.coveragePct).toBe(75);
    expect(report.termination.ended).toBe(200); // every run reaches END
    expect(report.termination).toMatchObject({ stalled: 0, capped: 0, evalError: 0 });
  });

  it("is bit-for-bit reproducible from the seed", () => {
    const again = runCoverage(loaded, { runs: 200, seed: 0 });
    expect(again).toEqual(report);
    const other = runCoverage(loaded, { runs: 200, seed: 1 });
    // A different seed is unlikely to give the identical branch split.
    expect(other.beats.find((b) => b.id === "L2")!.reachedRuns).not.toBe(beat("L2").reachedRuns);
  });

  it("honours a cancel signal and keeps the partial report", () => {
    let n = 0;
    const signal = { get aborted() { return ++n > 10; } };
    const partial = runCoverage(loaded, { runs: 200, seed: 0 }, { signal });
    expect(partial.cancelled).toBe(true);
    expect(partial.runs).toBeLessThan(200);
    expect(partial.runs).toBeGreaterThan(0);
  });
});

// A choice whose ONLY option is secret + gated on a property that is never set true: the option is always
// hidden, so the choice has nothing to offer and (no fallback) runs dry every run - a silent fall-through.
function makeDryChoiceProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-coverage-dry-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "dry", name: "Dry" },
    locales: { default: "en", all: ["en"] },
    properties: [{ name: "unlocked", type: "boolean", default: false }],
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }] },
        { id: "gDry", type: "group", selector: "choice", children: [
          { id: "oS", type: "group", prompt: { id: "CTs", kind: "text" }, secretUntilEligible: true, condition: "@unlocked",
            children: [{ id: "oS1", type: "snippet", beats: [{ id: "L2", kind: "line", character: "A" }] }] },
        ] },
        { id: "nEnd", type: "snippet", jump: { to: "END" } },
      ] },
    ] } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L1: "one", L2: "secret", CTs: "unlock" } });
  return dir;
}

describe("runCoverage dry choices", () => {
  const report = runCoverage(loadProject(makeDryChoiceProject()), { runs: 50, seed: 0 });

  it("reports the choice that ran dry, with the run count and scene", () => {
    expect(report.dryChoices).toEqual([{ id: "gDry", scene: "s1", runs: 50 }]);
  });
  it("does not derail the run: every playthrough still reaches the end", () => {
    expect(report.termination.ended).toBe(50);
    expect(report.termination.stalled).toBe(0);
  });
  it("leaves dryChoices empty for a story with no dry choices", () => {
    expect(runCoverage(loadProject(makeProject()), { runs: 50, seed: 0 }).dryChoices).toEqual([]);
  });
});

describe("resolveStart", () => {
  it("prefers an explicit override", () => {
    const loaded = loadProject(makeProject(true));
    expect(resolveStart(loaded, { scene: "other", block: "b" })).toEqual({ scene: "other", block: "b" });
  });
  it("falls back to the project's authored start", () => {
    const loaded = loadProject(makeProject(true));
    expect(resolveStart(loaded)).toEqual({ scene: "s1", block: undefined });
  });
  it("returns empty when no start is set (runtime first-scene default)", () => {
    const loaded = loadProject(makeProject(false));
    expect(resolveStart(loaded)).toEqual({});
  });
});
