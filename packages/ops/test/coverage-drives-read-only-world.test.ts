// A coverage driver must be able to move a READ-ONLY `@world` property.
//
// `writable: false` on a host declaration is the story's promise not to write the value; the game
// keeps it. Coverage IS the game here - it drives the host's inputs to see what the story does with
// them - so the property most likely to be declared read-only (a clock the story only reads) is
// exactly the one a driver most wants to move. Until 2026-09-05 the shared kernel refused every
// caller alike, so `engine.setProperty` threw and the whole run died on the ref the driver existed
// to feed; Patterpad would even PROPOSE that driver, so the app suggested a run that could not
// finish. Found on the Storylets side first, in venue content
// (from-storylets/host-writes-to-read-only-world).
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCoverage, proposeCoverageDrivers, loadProject } from "../src/index.js";
import type { ProjectFile, Scene, LocaleFile, CoverageDriver } from "@patterkit/model";

/** A project whose read-only clock gates a beat: the shape a driver exists for. */
function project(): string {
  const proj: ProjectFile = {
    schema: "patter/project@0", project: { id: "p", name: "P" },
    locales: { default: "en", all: ["en"] },
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [
      { name: "clock", type: "enum", values: ["day", "night"], default: "day", writable: false },
    ] }] },
  };
  const scene: Scene = { id: "s", type: "scene", name: "S", gameId: "s", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
      { id: "sn2", type: "snippet", condition: '@world.clock == "night"', beats: [{ id: "T2", kind: "text" }] },
    ] }] };
  const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", default: true,
    strings: { T1: "day or night", T2: "only at night" } };
  const dir = mkdtempSync(join(tmpdir(), "cov-read-only-"));
  mkdirSync(join(dir, "scenes"), { recursive: true });
  mkdirSync(join(dir, "loc", "en"), { recursive: true });
  writeFileSync(join(dir, "p.patterproj"), JSON.stringify(proj, null, 2));
  writeFileSync(join(dir, "scenes", "s.patterflow"), JSON.stringify({ schema: "patter/flow@0", scene }, null, 2));
  writeFileSync(join(dir, "loc", "en", "s.patterloc"), JSON.stringify(en, null, 2));
  return dir;
}

describe("coverage drives a read-only @world property", () => {
  it("runs, and reaches the beat that property gates", () => {
    const loaded = loadProject(project());
    const drivers: CoverageDriver[] = [{ ref: "@world.clock", kind: "initial", values: ["day", "night"] }];
    const report = runCoverage(loaded, { runs: 8, seed: 1, drivers });   // threw '@world.clock is read-only' before
    const night = report.beats.find((b) => b.id === "T2");
    expect(night?.hits).toBeGreaterThan(0);
  });

  it("and the driver Patterpad proposes for it is one the run can actually use", () => {
    // The proposer offers exactly this ref (a host ref no story writer feeds), so proposing one the
    // runtime would refuse was the app suggesting a run that dies.
    const loaded = loadProject(project());
    const proposed = proposeCoverageDrivers(loaded);
    expect(proposed.map((d) => d.ref)).toContain("@world.clock");
    const asInitial = proposed.map((d) => ({ ...d, kind: "initial" as const })); // this fixture has no choice points
    expect(() => runCoverage(loaded, { runs: 4, seed: 2, drivers: asInitial })).not.toThrow();
  });
});
