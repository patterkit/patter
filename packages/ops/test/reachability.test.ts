// ---------------------------------------------------------------------------
// Conditions that can never hold (reachability.ts), offered from the Storylet
// Studio side on 2026-08-30 with the warning that matters most: a false "this
// can never happen" is worse than silence, because it teaches authors to stop
// reading the panel.
//
// So most of this file is about the check STAYING QUIET. The one case that
// reports is the shape their author actually hit; everything else here is a
// reason to say nothing, and each one was probed by removing the guard that
// produces it and watching a false positive appear.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, reachabilityIssues, runValidate } from "../src/index.js";

type Node = Record<string, unknown>;

/** A one-scene project: some declarations, some nodes. */
function build(decls: Node[], nodes: Node[], sceneProps?: Node[]): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-reach-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "r", name: "Reach" },
    cast: [{ id: "A", name: "A" }],
    locales: { default: "en", all: ["en"] },
    start: { scene: "s1" },
    properties: decls,
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "weather", type: "boolean", default: false }] }] },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "S",
    ...(sceneProps ? { sceneProps } : {}),
    blocks: [{ id: "b1", type: "block", name: "M", children: nodes }],
  } });
  return dir;
}

const issues = (decls: Node[], nodes: Node[], sceneProps?: Node[]) =>
  reachabilityIssues(loadProject(build(decls, nodes, sceneProps)));

const LATCHES: Node[] = [
  { name: "connected", type: "boolean", default: false },
  { name: "seen", type: "boolean", default: false },
];

/** The Village's fault, in Patter's shape: `connected` is only ever set by a snippet that itself
 *  requires `seen`, and nothing sets `seen` back. So `connected && !seen` cannot hold. */
const VILLAGE: Node[] = [
  { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
    beats: [{ id: "L_look", kind: "line", character: "A" }] },
  { id: "n_set", type: "snippet", condition: "@seen",
    onEnter: [{ kind: "set", target: "@connected", value: "true" }],
    beats: [{ id: "L_set", kind: "line", character: "A" }] },
  { id: "n_dead", type: "snippet", condition: "@connected && !@seen",
    beats: [{ id: "L_dead", kind: "line", character: "A" }] },
];

describe("the fault it exists for", () => {
  it("refutes a latch that can only be set after the thing it is asked to precede", () => {
    const r = issues(LATCHES, VILLAGE);
    expect(r).toHaveLength(1);
    expect(r[0]!.nodeId).toBe("n_dead");
    expect(r[0]!.severity).toBe("warning");
    expect(r[0]!.message).toBe(
      "this can never run: @patter.connected can only become true after @patter.seen, "
      + "which nothing sets back, so this condition can never hold");
  });

  it("catches the same contradiction asked of itself", () => {
    const r = issues(LATCHES, [
      { id: "n_set", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "@seen && !@seen", beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r.map((i) => i.nodeId)).toEqual(["n_dead"]);
    expect(r[0]!.message).toContain("both set and not set");
  });

  it("reads a group's gate as part of the snippet's own", () => {
    // The contradiction is split across two levels, which is the same fault and the same sentence.
    const r = issues(LATCHES, [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "g", type: "group", condition: "@connected", children: [
        { id: "n_dead", type: "snippet", condition: "!@seen", beats: [{ id: "L2", kind: "line", character: "A" }] },
      ] },
    ]);
    expect(r.map((i) => i.nodeId)).toEqual(["n_dead"]);
  });

  it("names one root cause rather than every descendant of it", () => {
    const r = issues(LATCHES, [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "g", type: "group", condition: "@connected && !@seen", children: [
        { id: "kid1", type: "snippet", beats: [{ id: "L2", kind: "line", character: "A" }] },
        { id: "kid2", type: "snippet", condition: "@connected", beats: [{ id: "L3", kind: "line", character: "A" }] },
      ] },
    ]);
    expect(r.map((i) => i.nodeId)).toEqual(["g"]);
  });

  it("works on a single flag of a flags property", () => {
    const r = issues([{ name: "mood", type: "flags", values: ["armed", "calm"] }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@mood", value: "set_flags(@mood, +armed)" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "check_flags(@mood, +armed) && !@seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r.map((i) => i.nodeId)).toEqual(["n_dead"]);
    expect(r[0]!.message).toContain("@patter.mood +armed can only become true after @patter.seen");
  });
});

describe("what it refuses to say", () => {
  it("says nothing about a boolean ever written false", () => {
    // One write the other way and the ordering argument collapses. This is the guard doing the work.
    const r = issues(LATCHES, [
      ...VILLAGE,
      { id: "n_reset", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "false" }],
        beats: [{ id: "L_reset", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing about a flag that is ever cleared", () => {
    const r = issues([{ name: "mood", type: "flags", values: ["armed"] }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@mood", value: "set_flags(@mood, +armed)" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_clear", type: "snippet", onEnter: [{ kind: "set", target: "@mood", value: "set_flags(@mood, -armed)" }],
        beats: [{ id: "L2", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "check_flags(@mood, +armed) && !@seen",
        beats: [{ id: "L3", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing when a SECOND writer skips the gate", () => {
    // Requirements intersect across writers rather than union: one live route is enough. Union here
    // would flag a snippet that plays perfectly well.
    const r = issues(LATCHES, [
      ...VILLAGE,
      { id: "n_free", type: "snippet", onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L_free", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing about a latch nothing writes", () => {
    // That is dead state's story, and it is told better there.
    expect(issues(LATCHES, [
      { id: "n_dead", type: "snippet", condition: "@connected && !@seen", beats: [{ id: "L1", kind: "line", character: "A" }] },
    ])).toEqual([]);
  });

  it("says nothing about a boolean that DEFAULTS to true", () => {
    // Patter properties carry a default, which theirs do not. A latch that starts set has no ordering to
    // argue about: `seen` is true before anything runs, so nothing here is refutable.
    const r = issues([{ name: "connected", type: "boolean", default: false }, { name: "seen", type: "boolean", default: true }], VILLAGE);
    expect(r).toEqual([]);
  });

  it("says nothing about a flag the default already holds", () => {
    const r = issues([{ name: "mood", type: "flags", values: ["armed"], default: ["armed"] }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@mood", value: "set_flags(@mood, +armed)" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "check_flags(@mood, +armed) && !@seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing about a TEMPORARY scene-local", () => {
    // `temporary` reseeds on every scene entry, so the latch can go back down: not a latch.
    const r = issues([], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@scene.seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@scene.seen",
        onEnter: [{ kind: "set", target: "@scene.connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "@scene.connected && !@scene.seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ], [
      { name: "connected", type: "boolean", default: false },
      { name: "seen", type: "boolean", default: false, temporary: true },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing about a host-scope ref, even one the story writes", () => {
    // `@world` is the host's to write, in any direction, at any moment. The story setting it true here
    // would otherwise make it look like a latch, and the whole argument rests on nothing else moving it.
    const r = issues([{ name: "connected", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@world.weather", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@world.weather",
        onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "@connected && !@world.weather",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing when the writer's own gate is a disjunction", () => {
    // `@seen || @other` requires neither for certain, so the writer constrains nothing.
    const decls = [...LATCHES, { name: "other", type: "boolean", default: false }];
    const r = issues(decls, [
      { id: "n_other", type: "snippet", onEnter: [{ kind: "set", target: "@other", value: "true" }],
        beats: [{ id: "L0b", kind: "line", character: "A" }] },
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen || @other",
        onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "@connected && !@seen", beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing when the dead condition has a live OR branch", () => {
    const r = issues(LATCHES, [
      VILLAGE[0]!, VILLAGE[1]!,
      { id: "n_dead", type: "snippet", condition: "(@connected && !@seen) || @seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing about two latches that require each other", () => {
    // Both ARE unreachable, but that is a different diagnosis, and this one would give a true verdict
    // with a false reason. A cut answer never refutes.
    const decls = [...LATCHES, { name: "third", type: "boolean", default: false }];
    const r = issues(decls, [
      // connected requires third, third requires connected. Both really are unreachable, but that is a
      // DIFFERENT diagnosis, and answering it here would be a true verdict with a false reason.
      { id: "n_a", type: "snippet", condition: "@third",
        onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_b", type: "snippet", condition: "@connected",
        onEnter: [{ kind: "set", target: "@third", value: "true" }],
        beats: [{ id: "L2", kind: "line", character: "A" }] },
      { id: "n_dead", type: "snippet", condition: "@connected && !@third", beats: [{ id: "L3", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("keeps two scenes' scene-locals apart", () => {
    // `@scene.seen` in one scene is a different property from `@scene.seen` in another, so a writer in
    // one says nothing about a gate in the other.
    const dir = mkdtempSync(join(tmpdir(), "patter-reach-two-"));
    for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", {
      schema: "patter/project@0", project: { id: "r2", name: "Two" },
      cast: [{ id: "A", name: "A" }],
      locales: { default: "en", all: ["en"] }, start: { scene: "s1" },
    });
    const props = [{ name: "connected", type: "boolean", default: false }, { name: "seen", type: "boolean", default: false }];
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
      id: "s1", type: "scene", name: "One", sceneProps: props,
      blocks: [{ id: "b1", type: "block", name: "M", children: [
        { id: "n_set", type: "snippet", condition: "@scene.seen",
          onEnter: [{ kind: "set", target: "@scene.connected", value: "true" }],
          beats: [{ id: "L1", kind: "line", character: "A" }] },
      ] }] } });
    w("scenes/two.patterflow", { schema: "patter/flow@0", scene: {
      id: "s2", type: "scene", name: "Two", sceneProps: props,
      blocks: [{ id: "b2", type: "block", name: "M", children: [
        // Scene two writes its OWN `seen`, so that latch is real here; but its `connected` is written by
        // nobody, and scene one's writer of `connected` is a different property entirely.
        { id: "n_look2", type: "snippet", onEnter: [{ kind: "set", target: "@scene.seen", value: "true" }],
          beats: [{ id: "L1b", kind: "line", character: "A" }] },
        { id: "n_dead", type: "snippet", condition: "@scene.connected && !@scene.seen",
          beats: [{ id: "L2", kind: "line", character: "A" }] },
      ] }] } });
    expect(reachabilityIssues(loadProject(dir))).toEqual([]);
  });
});

describe("where it lands", () => {
  it("rides validate as a warning, and does not fail it", () => {
    const r = runValidate(loadProject(build(LATCHES, VILLAGE)));
    expect(r.reachability.map((i) => i.nodeId)).toEqual(["n_dead"]);
    // Content is written in pieces: "I have not authored that bit yet" must never fail a build.
    expect(r.ok).toBe(true);
  });

  it("is quiet on a project with nothing to prove", () => {
    const r = runValidate(loadProject(build(LATCHES, [
      { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }] },
    ])));
    expect(r.reachability).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("the shipped example", () => {
  it("reports nothing on examples/projects/tour.patter", () => {
    // Held to silence deliberately, the way their side holds its four examples. A check that speaks up
    // on the project we hand to newcomers has either found something real or is wrong; either way,
    // somebody should look before this test is changed.
    const dir = join(import.meta.dirname, "..", "..", "..", "examples", "projects", "tour.patter");
    expect(reachabilityIssues(loadProject(dir))).toEqual([]);
  });
});

describe("a latch that starts set, in either position", () => {
  // The Storylets side adopted our positive-latch fix and found it closes only one of two routes on
  // their side (from-storylets INDEX, 2026-08-30). Route two: a DEFAULTED latch is monotonic in the
  // sense that nothing moves it back, it simply never needed a writer, so it can still anchor a
  // refutation. Here that is closed by `preset` feeding `monotonic`, which gates both positions - but
  // the tests above only ever put a defaulted latch in the NEGATED position, so this is the case that
  // was going untested.
  it("says nothing when the POSITIVE term is a boolean defaulting to true", () => {
    const r = issues([{ name: "connected", type: "boolean", default: true }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@connected", value: "true" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      // @connected is true before anything runs, so it implies nothing about what ran first.
      { id: "n_live", type: "snippet", condition: "@connected && !@seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing when the POSITIVE term is a flag the default already holds", () => {
    const r = issues([{ name: "mood", type: "flags", values: ["armed"], default: ["armed"] }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@mood", value: "set_flags(@mood, +armed)" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_live", type: "snippet", condition: "check_flags(@mood, +armed) && !@seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });
});

describe("the scope the header claims", () => {
  // Their `world-refs-are-the-hosts` brief makes the point the hard way: a conservatism stated in a
  // design document and not implemented reads exactly like one that was never thought of, because the
  // whole family asserts silence and a missing guard produces silence too. So the scope this file's
  // header claims gets a case, rather than being taken on trust.
  it("says nothing about a quality ladder, even a genuinely unsatisfiable one", () => {
    // This condition really cannot hold: `rank` only advances behind `@seen`, nothing lowers it, and the
    // snippet also wants `!@seen`. Qualities are deliberately out of scope (ordered comparisons want
    // their own argument), so the right answer here is silence, not a report.
    //
    // Honest note on what this test is worth, since the family it sits in asserts silence: TWO separate
    // things keep qualities out - `advance()` is not read as a latch write, and an ordered comparison is
    // not read as a latch term - and either alone is enough. So no single-line mutation makes this
    // report, and probing it needs both opened at once, which it then does. It pins the SCOPE decision
    // rather than any one guard, and should not be mistaken for a guard test.
    const r = issues([{ name: "rank", type: "quality", stages: ["novice", "adept", "veteran"] }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@rank", value: "advance(@rank)" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_gated", type: "snippet", condition: "@rank >= \"veteran\" && !@seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });

  it("says nothing about a counter", () => {
    const r = issues([{ name: "gold", type: "number", default: 0 }, { name: "seen", type: "boolean", default: false }], [
      { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: "@seen", value: "true" }],
        beats: [{ id: "L0", kind: "line", character: "A" }] },
      { id: "n_set", type: "snippet", condition: "@seen",
        onEnter: [{ kind: "set", target: "@gold", value: "@gold + 1" }],
        beats: [{ id: "L1", kind: "line", character: "A" }] },
      { id: "n_gated", type: "snippet", condition: "@gold > 0 && !@seen",
        beats: [{ id: "L2", kind: "line", character: "A" }] },
    ]);
    expect(r).toEqual([]);
  });
});
