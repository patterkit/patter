// ---------------------------------------------------------------------------
// The analysis findings of the October 2026 CLI review (patterkit
// design/patter-cli-review-2026-10.md), each pinned by the trigger the review
// reproduced it with:
//
//   11  reachability called `@story` a latch the project controls
//   12  coverage's "blocked by" named a write that did run
//   15  an engine throw lost play's transcript and coverage's cause, and
//       validate was clean on a jump cycle with nothing to deliver
//   26  coverage's "may need an input" hint was wrong both ways
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { validateProject } from "@patterkit/core";
import {
  loadProject, reachabilityIssues, runCoverage, renderCoverageText, runPlay, renderPlay, runValidate,
} from "../src/index.js";
import type { CoverageReport } from "../src/index.js";

type Node = Record<string, unknown>;
interface SceneSpec { id: string; onEntry?: Node[]; blocks: Array<{ id: string; children: Node[] }> }

/** A project of the given scenes, starting at the first, with `@world` declared as given. */
function project(name: string, scenes: SceneSpec[], opts: { world?: Node[]; properties?: Node[] } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), `patter-review-${name}-`));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: name, name },
    cast: [{ id: "A", name: "A" }],
    locales: { default: "en", all: ["en"] },
    start: { scene: scenes[0]!.id },
    properties: opts.properties ?? [],
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: opts.world ?? [] }] },
  });
  for (const s of scenes) {
    w(`scenes/${s.id}.patterflow`, { schema: "patter/flow@0", scene: {
      id: s.id, type: "scene", name: s.id, ...(s.onEntry ? { onEntry: s.onEntry } : {}),
      blocks: s.blocks.map((b) => ({ id: b.id, type: "block", name: b.id, children: b.children })),
    } });
  }
  return dir;
}

const line = (id: string, extra: Node = {}): Node => ({ id: `n_${id}`, type: "snippet", ...extra, beats: [{ id, kind: "line", character: "A" }] });
const beat = (r: CoverageReport, id: string) => r.beats.find((b) => b.id === id)!;

describe("11: only @patter and @scene can be latches", () => {
  // The Village's fault with `@story.met` in place of `@seen`. The Storylet Engine sets @story whenever its
  // storylets say so, in either direction, so this story's one write proves no ordering at all.
  const village = (ref: string): Node[] => [
    { id: "n_look", type: "snippet", onEnter: [{ kind: "set", target: ref, value: "true" }], beats: [{ id: "L_look", kind: "line", character: "A" }] },
    { id: "n_set", type: "snippet", condition: ref, onEnter: [{ kind: "set", target: "@connected", value: "true" }],
      beats: [{ id: "L_set", kind: "line", character: "A" }] },
    { id: "n_dead", type: "snippet", condition: `@connected && !${ref}`, beats: [{ id: "L_dead", kind: "line", character: "A" }] },
  ];
  const props = [{ name: "connected", type: "boolean", default: false }, { name: "seen", type: "boolean", default: false }];

  it("says nothing about @story, which the Storylet Engine sets at will", () => {
    const dir = project("story-latch", [{ id: "s1", blocks: [{ id: "b1", children: village("@story.met") }] }], { properties: props });
    expect(reachabilityIssues(loadProject(dir))).toEqual([]);
  });

  it("still refutes the same shape on a @patter latch", () => {
    const dir = project("patter-latch", [{ id: "s1", blocks: [{ id: "b1", children: village("@seen") }] }], { properties: props });
    expect(reachabilityIssues(loadProject(dir)).map((i) => i.nodeId)).toEqual(["n_dead"]);
  });
});

describe("12: a write site is witnessed by its own visit count", () => {
  // The hall's entry sets @world.alarm. Play goes in and straight out through a prompt-only choice, so
  // none of the hall's beats ever plays: witnessed by them, the entry read as never run, and L_gated
  // (dead for want of @world.key) was blamed on @world.alarm, a write that ran in every run.
  const dir = project("entry-witness", [
    { id: "s1", blocks: [{ id: "b1", children: [
      line("L_intro"),
      line("L_gated", { condition: "@world.alarm && @world.key" }),
      { id: "n_go", type: "snippet", jump: { to: "hall" } },
    ] }] },
    { id: "hall", onEntry: [{ kind: "set", target: "@world.alarm", value: "true" }], blocks: [{ id: "b_hall", children: [
      line("L_hall", { condition: "@world.key" }),
      { id: "g_leave", type: "group", selector: "choice", children: [
        { id: "o_leave", type: "group", prompt: { id: "P_leave", kind: "line", character: "A" },
          children: [{ id: "n_leave", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }] },
  ], { world: [{ name: "alarm", type: "boolean", default: false }, { name: "key", type: "boolean", default: false }] });
  const r = runCoverage(loadProject(dir), { runs: 30, seed: 3 });

  it("does not blame a gate whose scene-entry writer ran", () => {
    expect(beat(r, "L_hall").reachedRuns).toBe(0); // none of the hall's beats played...
    expect(beat(r, "L_gated").reachedRuns).toBe(0);
    expect(beat(r, "L_gated").blockedBy).toBeUndefined(); // ...but its entry did, in every run
    expect(beat(r, "L_gated").needsInput).toEqual(["@world.key"]); // the real reason
  });

  it("names a scene-entry writer that never ran by its scene", () => {
    // The same hall, never entered (the jump is gone): now the claim is true, and the writer has no beat
    // to show, so it is named by the scene, which the CLI turns into the scene's name.
    const shut = project("entry-never", [
      { id: "s1", blocks: [{ id: "b1", children: [line("L_intro"), line("L_gated", { condition: "@world.alarm" })] }] },
      { id: "hall", onEntry: [{ kind: "set", target: "@world.alarm", value: "true" }], blocks: [{ id: "b_hall", children: [line("L_hall")] }] },
    ], { world: [{ name: "alarm", type: "boolean", default: false }] });
    const r2 = runCoverage(loadProject(shut), { runs: 10, seed: 3 });
    expect(beat(r2, "L_gated").blockedBy).toEqual([{ ref: "@world.alarm", writers: ["hall"] }]);
    expect(renderCoverageText(r2, (id) => (id === "hall" ? "The Hall" : id)).join("\n")).toContain("written only by: The Hall");
  });
});

describe("15: when the engine stops a run", () => {
  // b2 and b3 jump at each other with nothing between: the engine's transition guard throws.
  const cycle = (): string => project("cycle", [{ id: "s1", blocks: [
    { id: "b1", children: [line("L_intro"), { id: "n_go", type: "snippet", jump: { to: "b2" } }] },
    { id: "b2", children: [{ id: "n_there", type: "snippet", jump: { to: "b3" } }] },
    { id: "b3", children: [{ id: "n_back", type: "snippet", jump: { to: "b2" } }] },
  ] }]);

  it("play keeps the transcript and ends on the error, with outcome error", () => {
    const result = runPlay(loadProject(cycle()));
    expect(result.outcome).toBe("error");
    expect(result.events.map((e) => e.type)).toEqual(["line", "error"]);
    const last = result.events.at(-1)!;
    expect(last).toMatchObject({ type: "error", fatal: true, message: expect.stringMatching(/jump cycle/) });
    const text = renderPlay(result).join("\n");
    expect(text).toMatch(/! stopped: flow did not settle/);
    expect(text).toMatch(/--- stopped: the run could not go on ---$/);
  });

  it("play names an unknown scripted choice and what is on offer, before choosing", () => {
    const dir = project("scripted", [{ id: "s1", blocks: [{ id: "b1", children: [
      line("L_intro"),
      { id: "g", type: "group", selector: "choice", children: [
        { id: "o_a", type: "group", prompt: { id: "P_a", kind: "line", character: "A" }, children: [line("L_a")] },
        { id: "o_b", type: "group", prompt: { id: "P_b", kind: "line", character: "A" }, children: [line("L_b")] },
        { id: "o_shut", type: "group", condition: "@open", prompt: { id: "P_shut", kind: "line", character: "A" }, children: [line("L_shut")] },
      ] },
    ] }] }], { properties: [{ name: "open", type: "boolean", default: false }] });
    const unknown = runPlay(loadProject(dir), { choices: ["o_typo"] });
    expect(unknown.outcome).toBe("error");
    expect(unknown.events.map((e) => e.type)).toEqual(["line", "choice", "error"]);
    expect(unknown.events.at(-1)).toMatchObject({ message: "scripted choice 'o_typo' is not offered here; on offer: o_a, o_b" });
    const greyed = runPlay(loadProject(dir), { choices: ["o_shut"] });
    expect(greyed.events.at(-1)).toMatchObject({ message: "scripted choice 'o_shut' is offered but its condition does not hold here; on offer: o_a, o_b" });
  });

  it("coverage keeps the cause as a content error, with its run count", () => {
    const r = runCoverage(loadProject(cycle()), { runs: 12, seed: 1 });
    expect(r.termination.evalError).toBe(12);
    expect(r.contentErrors).toHaveLength(1);
    expect(r.contentErrors[0]).toMatchObject({ kind: "stopped", node: "s1", scene: "s1", runs: 12 });
    expect(r.contentErrors[0]!.message).toMatch(/jump cycle/);
    expect(renderCoverageText(r).join("\n")).toMatch(/12 run\(s\)\s+s1\s+run stopped: flow did not settle/);
  });

  it("validate warns on the cycle, without failing", () => {
    const loaded = loadProject(cycle());
    const found = validateProject({ project: loaded.project, scenes: loaded.scenes }).filter((i) => i.code === "jump-cycle");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", id: "n_there" });
    expect(found[0]!.message).toContain("'b2' -> 'b3' -> 'b2'");
    expect(runValidate(loaded).ok).toBe(true);
  });

  it("validate says nothing of a cycle that a condition, a beat, or a choice can break", () => {
    const quiet = (b3: Node[]): number => {
      const loaded = loadProject(project("cycle-quiet", [{ id: "s1", blocks: [
        { id: "b1", children: [line("L_intro"), { id: "n_go", type: "snippet", jump: { to: "b2" } }] },
        { id: "b2", children: [{ id: "n_there", type: "snippet", jump: { to: "b3" } }] },
        { id: "b3", children: b3 },
      ] }], { properties: [{ name: "more", type: "boolean", default: false }] }));
      return validateProject({ project: loaded.project, scenes: loaded.scenes }).filter((i) => i.code === "jump-cycle").length;
    };
    expect(quiet([{ id: "n_back", type: "snippet", condition: "@more", jump: { to: "b2" } }, line("L_out")])).toBe(0);
    expect(quiet([{ id: "n_back", type: "snippet", jump: { to: "b2" }, beats: [{ id: "L_x", kind: "line", character: "A" }] }])).toBe(0);
    expect(quiet([{ id: "g", type: "group", selector: "choice", children: [
      { id: "o", type: "group", prompt: { id: "P", kind: "line", character: "A" }, children: [{ id: "n_back", type: "snippet", jump: { to: "b2" } }] },
    ] }])).toBe(0);
    // And the provable shape through an empty bubble and a plain run group is still found.
    expect(quiet([{ id: "n_empty", type: "snippet" }, { id: "g", type: "group", children: [{ id: "n_back", type: "snippet", jump: { to: "s1" } }] }])).toBe(0);
    expect(quiet([{ id: "n_empty", type: "snippet" }, { id: "g", type: "group", children: [{ id: "n_back", type: "snippet", jump: { to: "b2" } }] }])).toBe(1);
  });
});

describe("26: the may-need-an-input hint", () => {
  const world = [{ name: "door", type: "boolean", default: false }, { name: "x", type: "boolean", default: false }];

  it("follows a gated jump: a block reached only past one is gated on it", () => {
    const dir = project("jump-gate", [{ id: "s1", blocks: [
      { id: "b1", children: [line("L_intro"), { id: "n_go", type: "snippet", condition: "@world.door", jump: { to: "b2" } }] },
      { id: "b2", children: [line("L_far")] },
    ] }], { world });
    const r = runCoverage(loadProject(dir), { runs: 20, seed: 2 });
    expect(beat(r, "L_far").reachedRuns).toBe(0);
    expect(beat(r, "L_far").needsInput).toEqual(["@world.door"]);
    expect(r.unwrittenInputs).toEqual(["@world.door"]);
  });

  it("stays quiet when another way into the block needs no input", () => {
    // The second way in is dead for its own reason (a @patter flag nothing sets), but it asks nothing of
    // the host, so @world.door is not what every route needs.
    const dir = project("jump-open", [{ id: "s1", blocks: [
      { id: "b1", children: [
        line("L_intro"),
        { id: "n_go", type: "snippet", condition: "@world.door", jump: { to: "b2" } },
        { id: "n_also", type: "snippet", condition: "@never", jump: { to: "b2" } },
      ] },
      { id: "b2", children: [line("L_far")] },
    ] }], { world, properties: [{ name: "never", type: "boolean", default: false }] });
    const r = runCoverage(loadProject(dir), { runs: 20, seed: 2 });
    expect(beat(r, "L_far").reachedRuns).toBe(0);
    expect(beat(r, "L_far").needsInput).toBeUndefined();
  });

  it("drops the hint on a branch child an unconditional sibling before it always beats", () => {
    const branch = (first: Node): string => project("branch", [{ id: "s1", blocks: [{ id: "b1", children: [
      { id: "g", type: "group", selector: "branch", children: [first, line("L_late", { condition: "@world.x" })] },
    ] }] }], { world });
    const always = runCoverage(loadProject(branch(line("L_first"))), { runs: 20, seed: 2 });
    expect(beat(always, "L_late").reachedRuns).toBe(0);
    expect(beat(always, "L_late").needsInput).toBeUndefined(); // no input could reach it
    expect(always.unwrittenInputs).toEqual([]);
    // A conditional first child can lose, so the input could matter, and the hint stays.
    const maybe = runCoverage(loadProject(branch(line("L_first", { condition: "!@world.door" }))), { runs: 20, seed: 2 });
    expect(beat(maybe, "L_late").needsInput).toEqual(["@world.x"]);
  });
});
