// The engine plays through a condition or effect that fails (a failing condition counts as false, a failing
// effect is skipped), so the tools must be where an author hears about it. Coverage lists each failure with
// how many runs hit it; a scripted playthrough records it in its transcript, and `patter play` exits 1.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runCoverage, renderCoverageText, runPlay, renderPlay } from "../src/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-content-errors-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "err", name: "Err" },
    locales: { default: "en", all: ["en"] }, start: { scene: "s1" },
    properties: [{ name: "zero", type: "number", default: 0 }, { name: "x", type: "number", default: 0 }],
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n_fx", type: "snippet", onEnter: [{ kind: "set", target: "@x", value: "1 / @zero" }],
          beats: [{ id: "L0", kind: "line", character: "A" }] },
        { id: "g1", type: "group", selector: "branch", children: [
          { id: "n_bad", type: "snippet", condition: "1 / @zero > 1", beats: [{ id: "L1", kind: "line", character: "A" }] },
          { id: "n_ok", type: "snippet", beats: [{ id: "L2", kind: "line", character: "A" }] },
        ] },
        { id: "nEnd", type: "snippet", jump: { to: "END" } },
      ] },
    ] } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L0: "zero", L1: "bad", L2: "ok" } });
  return dir;
}

const loaded = loadProject(makeProject());

describe("content errors in coverage", () => {
  const report = runCoverage(loaded, { runs: 50, seed: 1 });
  it("lists each failure with how many runs hit it, and every run still ends", () => {
    expect(report.termination.ended).toBe(50);
    expect(report.contentErrors.map((e) => [e.kind, e.node, e.scene, e.runs])).toEqual([
      ["condition", "n_bad", "s1", 50], ["effect", "n_fx", "s1", 50],
    ]);
  });
  it("says so in the CLI's text", () => {
    const text = renderCoverageText(report, () => "Start").join("\n");
    expect(text).toMatch(/content errors .*: 2/);
    expect(text).toMatch(/condition on 'n_bad' \(1 \/ @zero > 1\)/);
  });
});

describe("content errors in a playthrough", () => {
  it("are recorded in order and shown in the transcript", () => {
    const result = runPlay(loaded);
    expect(result.outcome).toBe("end");
    expect(result.events.map((e) => e.type)).toEqual(["error", "line", "error", "line"]);
    expect(renderPlay(result).join("\n")).toMatch(/! effect on 'n_fx' \(1 \/ @zero\) failed, played through/);
  });
});
