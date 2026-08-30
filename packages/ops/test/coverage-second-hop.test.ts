// ---------------------------------------------------------------------------
// Coverage, two questions raised from the Storylet Studio side on 2026-08-30.
//
// 1. THE BUG WE DO NOT HAVE. Their sweep tested exhaustion against the SWEEP-WIDE
//    tallies, so once the cumulative sweep had seen everything, every later run
//    broke after its first play: a 5000-run report was a ~84-run sample, and said
//    5000. Our sweep has no sweep-wide short-circuit, and this pins that rather
//    than leaving it to a reading of the loop.
//
// 2. THE BLIND SPOT WE DO. `needsInput` asks "does anything write this gate?" and
//    stops. A gate written ONLY by content that was itself never reached reads as
//    perfectly wired, so two dead beats sit there with one cause and no arrow
//    between them.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runCoverage } from "../src/index.js";
import type { CoverageReport } from "../src/index.js";

type Node = Record<string, unknown>;

function project(name: string, decls: Node[], nodes: Node[]): string {
  const dir = mkdtempSync(join(tmpdir(), `patter-cov-${name}-`));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: name, name },
    locales: { default: "en", all: ["en"] },
    start: { scene: "s1" },
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: decls }] },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start",
    blocks: [{ id: "b1", type: "block", name: "Main", children: nodes }],
  } });
  return dir;
}

const run = (dir: string, runs: number): CoverageReport =>
  runCoverage(loadProject(dir), { runs, seed: 7 });
const beat = (r: CoverageReport, id: string) => r.beats.find((b) => b.id === id)!;

describe("every run asked for is a run taken", () => {
  // Two beats, no gates, no choices: run one sees the whole story. A sweep that stopped early once its
  // cumulative tallies were full would report the runs it was ASKED for while sampling far fewer.
  const dir = project("exhaust", [], [
    { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }] },
    { id: "n2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "A" }] },
  ]);

  it("keeps sampling after the content is exhausted", () => {
    const r = run(dir, 200);
    expect(r.runs).toBe(200);
    const { ended, capped, stalled, evalError } = r.termination;
    expect(ended + capped + stalled + evalError).toBe(200); // every run terminated on its own account
    expect(beat(r, "L1").reachedRuns).toBe(200);            // and each was a real playthrough
    expect(beat(r, "L1").hits).toBe(200);
  });

  it("scales the tallies with the run count, rather than freezing them", () => {
    // The tell that found it on their side: a 5000-run report byte-identical to a 200-run one.
    expect(run(dir, 50).beats[0]!.hits).toBe(50);
    expect(run(dir, 400).beats[0]!.hits).toBe(400);
  });
});

describe("a gate whose only writer was never reached", () => {
  // L_locked is gated on @world.alarm. Something DOES write it, so needsInput stays quiet - but the only
  // writer hangs off L_dead, which is gated on an input nothing feeds. Two dead beats, one cause.
  const dir = project("hop", [{ name: "alarm", type: "boolean", default: false }, { name: "key", type: "boolean", default: false }], [
    { id: "n0", type: "snippet", beats: [{ id: "L_intro", kind: "line", character: "A" }] },
    { id: "n_dead", type: "snippet", condition: "@world.key",
      onEnter: [{ kind: "set", target: "@world.alarm", value: "true" }],
      beats: [{ id: "L_dead", kind: "line", character: "A" }] },
    { id: "n_locked", type: "snippet", condition: "@world.alarm",
      beats: [{ id: "L_locked", kind: "line", character: "A" }] },
  ]);
  const r = run(dir, 40);

  it("says nothing about the beat that DID play", () => {
    expect(beat(r, "L_intro").reachedRuns).toBe(40);
    expect(beat(r, "L_intro").blockedBy).toBeUndefined();
  });

  it("names the gate and the writer that would have to play first", () => {
    expect(beat(r, "L_locked").reachedRuns).toBe(0);
    expect(beat(r, "L_locked").blockedBy).toEqual([{ ref: "@world.alarm", writers: ["L_dead"] }]);
  });

  it("leaves the FIRST hop to answer the beat that is genuinely unfed", () => {
    // L_dead's own gate is unwritten, which is the existing hint's job. It is not blocked by anything.
    expect(beat(r, "L_dead").needsInput).toEqual(["@world.key"]);
    expect(beat(r, "L_dead").blockedBy).toBeUndefined();
    // And the written gate never lands in the unwritten-input list.
    expect(r.unwrittenInputs).toEqual(["@world.key"]);
  });
});

describe("flag granularity, which is the whole trick", () => {
  // @world.mood is written constantly by content that plays. Keyed coarsely, the hop finds nothing. The
  // gate reads ONE flag, and that flag's only writer is the beat nothing reaches.
  const decls = [{ name: "mood", type: "flags", values: ["calm", "armed"] }, { name: "key", type: "boolean", default: false }];
  const nodes: Node[] = [
    { id: "n0", type: "snippet", onEnter: [{ kind: "set", target: "@world.mood", value: "set_flags(@world.mood, +calm)" }],
      beats: [{ id: "L_intro", kind: "line", character: "A" }] },
    { id: "n_dead", type: "snippet", condition: "@world.key",
      onEnter: [{ kind: "set", target: "@world.mood", value: "set_flags(@world.mood, +armed)" }],
      beats: [{ id: "L_dead", kind: "line", character: "A" }] },
    { id: "n_locked", type: "snippet", condition: "check_flags(@world.mood, +armed)",
      beats: [{ id: "L_locked", kind: "line", character: "A" }] },
  ];
  const r = run(project("flags", decls, nodes), 40);

  it("keys the gate by the flag, not the property", () => {
    expect(beat(r, "L_locked").reachedRuns).toBe(0);
    expect(beat(r, "L_locked").blockedBy).toEqual([{ ref: "@world.mood:armed", writers: ["L_dead"] }]);
  });

  it("does not blame the property, which is written all over the place", () => {
    // The coarse key has a live writer (L_intro sets +calm every run), so reporting it would be false.
    expect(beat(r, "L_locked").blockedBy!.some((b) => b.ref === "@world.mood")).toBe(false);
  });

  it("drops the claim when something assigns the whole property", () => {
    // An opaque write (not a per-flag delta) means no per-flag claim is refutable, so the hop goes quiet
    // rather than guessing. Only report what you can refute.
    const opaque = [...nodes];
    opaque[0] = { ...(nodes[0] as Node), onEnter: [{ kind: "set", target: "@world.mood", value: "@world.mood" }] };
    const r2 = run(project("opaque", decls, opaque), 40);
    expect(beat(r2, "L_locked").reachedRuns).toBe(0);
    expect(beat(r2, "L_locked").blockedBy).toBeUndefined();
  });
});

describe("what it refuses to claim", () => {
  // The failure this check cannot recover from is a FALSE "this can never happen": an author who sees one
  // stops reading the panel. These two cases are the ones that would produce one.
  const decls = [{ name: "alarm", type: "boolean", default: false }, { name: "key", type: "boolean", default: false }];

  it("stays quiet when ONE of several writers does play", () => {
    // Same shape as the blocked case, plus a second writer on the path everybody takes. The gate is fed,
    // so nothing here is dead at one remove, whatever the other writer is doing.
    const r = run(project("twowriters", decls, [
      { id: "n0", type: "snippet", onEnter: [{ kind: "set", target: "@world.alarm", value: "true" }],
        beats: [{ id: "L_intro", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "@world.key",
        onEnter: [{ kind: "set", target: "@world.alarm", value: "true" }],
        beats: [{ id: "L_dead", kind: "line", character: "A" }] },
      { id: "n_gated", type: "snippet", condition: "@world.alarm && @world.key",
        beats: [{ id: "L_gated", kind: "line", character: "A" }] },
    ]), 40);
    expect(beat(r, "L_gated").reachedRuns).toBe(0);            // dead for its own reason (@world.key)
    expect(beat(r, "L_gated").blockedBy).toBeUndefined();      // but NOT because @world.alarm is unwritten
  });

  it("stays quiet when a writer's running cannot be witnessed", () => {
    // n_silent writes the gate and has no beats of its own, so no measurement says whether it ran. It may
    // well have. Claiming the gate is unwritten-in-practice would be a guess, so the hop drops it.
    const r = run(project("unwitnessed", decls, [
      { id: "n0", type: "snippet", beats: [{ id: "L_intro", kind: "line", character: "A" }] },
      { id: "n_silent", type: "snippet", condition: "@world.key",
        onEnter: [{ kind: "set", target: "@world.alarm", value: "true" }] },
      { id: "n_gated", type: "snippet", condition: "@world.alarm",
        beats: [{ id: "L_gated", kind: "line", character: "A" }] },
    ]), 40);
    expect(beat(r, "L_gated").reachedRuns).toBe(0);
    expect(beat(r, "L_gated").blockedBy).toBeUndefined();
  });
});
