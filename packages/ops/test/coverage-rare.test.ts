// ---------------------------------------------------------------------------
// Coverage leads with what it reached LEAST. It used to flag only the never-reached, so a beat played in
// half a percent of runs looked as healthy as one played in all of them, and the table ran in script
// order, so the rows worth a look were wherever the script put them. Now a reached-but-rare beat is
// flagged, the report counts them, and both the CLI's text and Patterpad's window lead least-reached.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runCoverage, renderCoverageText, leastReachedFirst, RARE_REACH_PCT } from "../src/index.js";
import type { CoverageBeat } from "../src/index.js";

// L0 always plays; a 30-way choice then plays exactly one of R1..R30 (each about 3% of runs); a jump to END
// leaves Ldead unreachable.
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-coverage-rare-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "rare", name: "Rare" },
    locales: { default: "en", all: ["en"] }, start: { scene: "s1" },
  });
  const options = Array.from({ length: 30 }, (_, i) => ({
    id: `o${i + 1}`, type: "group", prompt: { id: `P${i + 1}`, kind: "text" },
    children: [{ id: `on${i + 1}`, type: "snippet", beats: [{ id: `R${i + 1}`, kind: "line", character: "A" }] }],
  }));
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n0", type: "snippet", beats: [{ id: "L0", kind: "line", character: "A" }] },
        { id: "g1", type: "group", selector: "choice", children: options },
        { id: "nEnd", type: "snippet", jump: { to: "END" } },
        { id: "nDead", type: "snippet", beats: [{ id: "Ldead", kind: "line", character: "A" }] },
      ] },
    ] } });
  const strings: Record<string, string> = { L0: "always", Ldead: "never" };
  for (let i = 1; i <= 30; i++) { strings[`R${i}`] = `rare ${i}`; strings[`P${i}`] = `pick ${i}`; }
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings });
  return dir;
}

const loaded = loadProject(makeProject());
const report = runCoverage(loaded, { runs: 2000, seed: 3 });
const beat = (id: string) => report.beats.find((b) => b.id === id)!;
const rareIds = report.beats.filter((b) => b.rare).map((b) => b.id);

describe("rarely reached beats", () => {
  it("flags a beat reached in fewer than RARE_REACH_PCT% of runs", () => {
    expect(RARE_REACH_PCT).toBe(5);
    expect(report.rareThresholdPct).toBe(RARE_REACH_PCT);
    expect(rareIds.length).toBeGreaterThan(20); // each of the 30 options is about 3%
    for (const id of rareIds) {
      expect(beat(id).reachedRuns).toBeGreaterThan(0);
      expect(beat(id).reachPct).toBeLessThan(RARE_REACH_PCT);
    }
  });

  it("never flags the always-played line, or a never-reached one (that has its own, louder flag)", () => {
    expect(beat("L0").rare).toBeUndefined();
    expect(beat("Ldead").reachedRuns).toBe(0);
    expect(beat("Ldead").rare).toBeUndefined();
  });

  it("counts them in the totals", () => {
    expect(report.totals.rare).toBe(rareIds.length);
  });
});

describe("leastReachedFirst", () => {
  it("puts the never-reached first, then by reach %, and the always-played last", () => {
    const ordered = leastReachedFirst(report.beats);
    expect(ordered[0]!.id).toBe("Ldead");
    expect(ordered.at(-1)!.id).toBe("L0");
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]!.reachPct).toBeGreaterThanOrEqual(ordered[i - 1]!.reachPct);
  });

  it("breaks a tie on reach % by times played, then keeps script order", () => {
    const b = (id: string, reachPct: number, hits: number): CoverageBeat =>
      ({ id, scene: "s", kind: "line", preview: id, hits, reachedRuns: hits, reachPct });
    const ordered = leastReachedFirst([b("a", 10, 9), b("b", 10, 3), b("c", 10, 3), b("d", 2, 50)]);
    expect(ordered.map((x) => x.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("does not reorder the report's own list", () => {
    const before = report.beats.map((b) => b.id);
    leastReachedFirst(report.beats);
    expect(report.beats.map((b) => b.id)).toEqual(before);
  });
});

describe("the CLI's coverage text", () => {
  const lines = renderCoverageText(report, () => "Start");
  const text = lines.join("\n");

  it("says how many beats were rarely reached, and what rare means", () => {
    expect(lines[0]).toMatch(new RegExp(`${rareIds.length} rarely reached \\(under 5% of runs\\)`));
    expect(text).toMatch(/~ rarely reached \(under 5% of runs\)/);
  });

  it("labels its two number columns", () => {
    expect(text).toMatch(/reached {2}played {2}beat/);
    expect(text).toMatch(/reached = share of runs that played the beat at least once; played = times it played in all runs/);
  });

  it("says in words how the runs ended", () => {
    expect(text).toMatch(/stalled at a choice with nothing to pick/);
    expect(text).toMatch(/hit the step limit/);
  });

  it("leads with the least reached by default: the dead line first, marked, then rare lines marked ~", () => {
    const heading = lines.findIndex((l) => l.includes("reached  played  beat"));
    expect(lines[heading - 1]).toBe("least reached first");
    expect(lines[heading + 1]).toMatch(/^ {2}‼ +0% .*never$/);
    expect(lines[heading + 2]).toMatch(/^ {2}~ /);
    expect(lines.at(-1)).toMatch(/100% .*always$/);
  });

  it("keeps the script's order, scene by scene, when asked", () => {
    const script = renderCoverageText(report, () => "Start", { order: "script" });
    const heading = script.findIndex((l) => l.includes("reached  played  beat"));
    expect(script[heading - 1]).toMatch(/^Start {2}\(1 never reached, \d+ rarely reached\)$/);
    expect(script[heading + 1]).toMatch(/100% .*always$/);
    expect(script.at(-1)).toMatch(/^ {2}‼ .*never$/);
  });
});
