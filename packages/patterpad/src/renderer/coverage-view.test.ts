// @vitest-environment jsdom
// The Coverage window's beat table: labelled columns, least reached first by default with a switch to the
// script's order, and a quiet "Rare" tag on beats reached in only a few runs. The window's ordering is
// restated from @patterkit/ops (the renderer cannot load that Node package), so the last test pins the two
// together: a change to either that the other does not follow fails here.

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderCoverage, leastReachedFirst } from "./src/coverage-view.js";
import { leastReachedFirst as opsLeastReachedFirst } from "@patterkit/ops";
import type { CoverageBeat, CoverageReport } from "./../shared/api.js";

afterEach(() => { document.body.replaceChildren(); });

const beat = (id: string, scene: string, reachPct: number, hits: number, extra: Partial<CoverageBeat> = {}): CoverageBeat => ({
  id, scene, kind: "line", character: "A", preview: `text ${id}`, hits, reachedRuns: Math.round(reachPct * 10), reachPct, ...extra,
});

// Script order: always (100%), common (50%), rare (2%), dead (0%) in scene one; a second scene with one line.
const beats: CoverageBeat[] = [
  beat("always", "s1", 100, 1000),
  beat("common", "s1", 50, 500),
  beat("rare", "s1", 2, 20, { rare: true }),
  beat("dead", "s1", 0, 0),
  beat("other", "s2", 70, 700),
];
const report: CoverageReport = {
  runs: 1000, maxSteps: 200, seed: 1, start: {}, beats,
  totals: { beats: 5, covered: 4, neverHit: 1, rare: 1, coveragePct: 80 }, rareThresholdPct: 5,
  termination: { ended: 900, capped: 100, stalled: 0, evalError: 0 },
  drivers: [], unwrittenInputs: [], dryChoices: [], cancelled: false,
};
const names: Record<string, string> = { s1: "Scene one", s2: "Scene two" };

const mount = (opts?: Parameters<typeof renderCoverage>[5]): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  renderCoverage(host, report, (id) => names[id] ?? id, () => {}, undefined, opts);
  return host;
};
const rowIds = (host: HTMLElement): string[] =>
  [...host.querySelectorAll(".cov-table tbody tr .cov-text")].map((t) => t.textContent!.replace("A: text ", ""));

describe("the coverage beat table", () => {
  it("labels its columns, each explaining itself", () => {
    const host = mount();
    const heads = [...host.querySelectorAll(".cov-table thead th")];
    expect(heads.map((h) => h.textContent)).toEqual(["", "Beat", "Runs reached", "Times played"]);
    expect(heads[2]!.getAttribute("data-tip")).toMatch(/share of runs/);
    expect(heads[3]!.getAttribute("data-tip")).toMatch(/across all runs/);
  });

  it("opens least reached first, as one list across scenes, each row naming its scene", () => {
    const host = mount();
    expect(rowIds(host)).toEqual(["dead", "rare", "common", "other", "always"]);
    expect(host.querySelectorAll(".cov-table").length).toBe(1);
    expect(host.querySelector(".cov-row-scene")?.textContent).toBe("Scene one");
    expect(host.querySelector(".seg-opt.on")?.textContent).toBe("Least reached first");
  });

  it("switches to the script's order, a table per scene, and says so", () => {
    const onOrderChange = vi.fn();
    const host = mount({ onOrderChange });
    const script = [...host.querySelectorAll<HTMLButtonElement>(".seg-opt")].find((b) => b.textContent === "Script order")!;
    script.click();
    expect(rowIds(host)).toEqual(["always", "common", "rare", "dead", "other"]);
    expect([...host.querySelectorAll(".cov-scene-cap > span:first-child")].map((s) => s.textContent)).toEqual(["Scene one", "Scene two"]);
    expect(host.querySelector(".cov-scene-rare")?.textContent).toBe("1 rarely reached");
    expect(host.querySelector(".cov-row-scene")).toBeNull();
    expect(onOrderChange).toHaveBeenCalledWith("script");
  });

  it("opens in the order it is given", () => {
    expect(rowIds(mount({ order: "script" }))).toEqual(["always", "common", "rare", "dead", "other"]);
  });

  it("tags a rarely reached beat, softly, and counts them in the summary", () => {
    const host = mount();
    const rareRow = [...host.querySelectorAll(".cov-table tbody tr")].find((r) => r.textContent!.includes("text rare"))!;
    expect(rareRow.classList.contains("cov-row-rare")).toBe(true);
    expect(rareRow.querySelector(".cov-rare")?.textContent).toBe("Rare");
    expect(rareRow.querySelector(".cov-rare")?.getAttribute("data-tip")).toMatch(/fewer than 5% of runs/);
    const labels = [...host.querySelectorAll(".cov-stat-label")].map((l) => l.textContent);
    expect(labels).toContain("Rarely reached");
  });

  it("orders exactly as the CLI does (@patterkit/ops' leastReachedFirst)", () => {
    const tricky = [...beats, beat("tieA", "s1", 50, 900), beat("tieB", "s1", 50, 100), beat("tieC", "s2", 50, 100)];
    expect(leastReachedFirst(tricky).map((b) => b.id)).toEqual(opsLeastReachedFirst(tricky).map((b) => b.id));
  });
});
