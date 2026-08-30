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
      { id: "L5", scene: "bar", kind: "line", character: "BARKEEP", preview: "You came armed, then.", hits: 0, reachedRuns: 0, reachPct: 0,
        blockedBy: [{ ref: "@world.mood:armed", writers: ["L4"] }] },
    ],
    totals: { beats: 4, covered: 2, neverHit: 2, coveragePct: 50 },
    termination: { ended: 5000, capped: 0, stalled: 0, evalError: 0 },
    drivers: [{ ref: "@world.mood", kind: "recurring", cadence: "sometimes", values: ["calm", "tense"] }],
    unwrittenInputs: ["@world.alarm"],
    dryChoices: [{ id: "grp_barmenu", scene: "bar", runs: 812 }],
    cancelled: false,
  },
};

// A FAKE sweep, so the progress strip is actually drivable here: it ticks for a few seconds, reports
// progress on the same shape main sends, and honours Cancel by resolving with a short, honest report.
// Without this the strip could only ever be seen in its finished state.
const TOTAL = 5000;
const TICK_MS = 40;
const PER_TICK = 120;

type ProgressHandler = (p: { kind: string; done: number; total: number; elapsedMs: number }) => void;
let onProgress: ProgressHandler | undefined;
let cancelled = false;

// EVERY count has to be scaled with the run total, not just the headline: a fixture reading "840 runs"
// over "5,000 ended" or a beat hit 5,000 times is exactly the confusion the honest `runs` count exists
// to prevent, and a preview that contradicts itself teaches the next person the wrong thing about what
// the real report looks like. Percentages are untouched, being ratios.
const partial = (done: number): CoverageResult => {
  const scale = (n: number): number => Math.round(n * (done / TOTAL));
  return {
    sceneNames: sample.sceneNames,
    report: {
      ...sample.report,
      runs: done,
      cancelled: true,
      termination: { ...sample.report.termination, ended: done },
      beats: sample.report.beats.map((b) => ({ ...b, hits: scale(b.hits), reachedRuns: scale(b.reachedRuns) })),
      dryChoices: sample.report.dryChoices.map((d) => ({ ...d, runs: scale(d.runs) })),
    },
  };
};

const stub = {
  info: async () => ({
    hasProject: true,
    pinned: true,
    theme: { colour: "system" as const, font: "newsreader" as const },
    scenes: [{ id: "intro", name: "Intro" }, { id: "bar", name: "At the Bar" }],
    start: { scene: "intro" },
    driverCount: 1,
    last: null, // first open shows the empty state; pressing Run produces the sample
  }),
  run: (): Promise<CoverageResult> => new Promise((resolve) => {
    cancelled = false;
    const started = Date.now();
    let done = 0;
    const timer = setInterval(() => {
      if (cancelled) { clearInterval(timer); resolve(partial(done)); return; }
      done = Math.min(TOTAL, done + PER_TICK);
      onProgress?.({ kind: "coverage", done, total: TOTAL, elapsedMs: Date.now() - started });
      if (done >= TOTAL) { clearInterval(timer); resolve(sample); }
    }, TICK_MS);
  }),
  cancel: () => { cancelled = true; },
  onProgress: (handler: ProgressHandler) => { onProgress = handler; },
  reveal: (sceneId: string, beatId: string) => console.log("reveal", sceneId, beatId),
  openWorld: () => console.log("openWorld"),
  findUsage: (ref: string) => console.log("findUsage", ref),
  setPin: (on: boolean) => console.log("setPin", on),
  onProject: () => undefined,
  onPin: () => undefined,
  onTheme: () => undefined,
};
(window as unknown as { patterCoverage: unknown }).patterCoverage = stub;
void import("../coverage/coverage.js");
