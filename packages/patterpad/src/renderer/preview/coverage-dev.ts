// DEV-ONLY preview of the coverage WINDOW (stubs window.patterCoverage with a canned report). See dev.ts.
import type { CoverageResult } from "../../shared/api.js";

const sample: CoverageResult = {
  sceneNames: { intro: "Intro", bar: "At the Bar" },
  report: {
    runs: 5000, maxSteps: 200, seed: 0, start: { scene: "intro" },
    beats: [
      { id: "L1", scene: "intro", kind: "line", character: "BARKEEP", preview: "Welcome, traveller.", hits: 5000, reachedRuns: 5000, reachPct: 100 },
      { id: "L2", scene: "intro", kind: "line", character: "ANNA", preview: "You again?", hits: 2480, reachedRuns: 2480, reachPct: 49.6 },
      { id: "L3", scene: "bar", kind: "text", preview: "The fire crackles.", hits: 0, reachedRuns: 0, reachPct: 0 },
      { id: "L4", scene: "bar", kind: "line", character: "BARKEEP", preview: "The guards are here!", hits: 0, reachedRuns: 0, reachPct: 0, needsInput: ["@world.alarm"] },
    ],
    totals: { beats: 4, covered: 2, neverHit: 2, coveragePct: 50 },
    termination: { ended: 5000, capped: 0, stalled: 0, evalError: 0 },
    drivers: [{ ref: "@world.mood", kind: "recurring", cadence: "sometimes", values: ["calm", "tense"] }],
    unwrittenInputs: ["@world.alarm"],
    dryChoices: [{ id: "grp_barmenu", scene: "bar", runs: 812 }],
    cancelled: false,
  },
};

const stub = {
  info: async () => ({
    hasProject: true,
    pinned: true,
    scenes: [{ id: "intro", name: "Intro" }, { id: "bar", name: "At the Bar" }],
    start: { scene: "intro" },
    driverCount: 1,
    last: null, // first open shows the empty state; pressing Run produces the sample
  }),
  run: async () => sample,
  reveal: (sceneId: string, beatId: string) => console.log("reveal", sceneId, beatId),
  openWorld: () => console.log("openWorld"),
  findUsage: (ref: string) => console.log("findUsage", ref),
  setPin: (on: boolean) => console.log("setPin", on),
  onProject: () => undefined,
};
(window as unknown as { patterCoverage: unknown }).patterCoverage = stub;
void import("../coverage/coverage.js");
