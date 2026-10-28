// ---------------------------------------------------------------------------
// Content that can never run (the hands-on review, 2026-10; Q6, ruled 2026-10-28): in a run (a block's
// children, a plain group, an option's own run), a sibling after an unconditioned snippet that jumps (not
// calls) never plays, and validate warns on it. A condition, or a jump inside an option, a conditional
// group or a selector's child, is a branch that might not be taken: it never hides what follows.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Group, ProjectFile, Scene, Snippet } from "@patterkit/model";
import { neverRunNodes, validateProject } from "@patterkit/core";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] },
  cast: [{ name: "TAM" }], start: { scene: "s" },
};
const line = (id: string): Snippet => ({ id, type: "snippet", beats: [{ id: `${id}_L`, kind: "line", character: "TAM" }] });
const jumper = (id: string, to = "END", extra: Partial<Snippet> = {}): Snippet => ({ ...line(id), jump: { to }, ...extra });
const option = (id: string, children: Array<Group | Snippet>, extra: Partial<Group> = {}): Group =>
  ({ id, type: "group", prompt: { id: `${id}_P`, kind: "text" }, children, ...extra });
const scene = (children: Array<Group | Snippet>): Scene => ({ id: "s", type: "scene", name: "S", blocks: [
  { id: "b", type: "block", name: "B", children },
  { id: "b2", type: "block", name: "Elsewhere", children: [line("elsewhere")] },
] });
const unreachable = (children: Array<Group | Snippet>): Array<[string | undefined, string | undefined]> =>
  validateProject({ project, scenes: [scene(children)] })
    .filter((i) => i.code === "unreachable-after-jump").map((i) => [i.id, i.jumper]);

describe("unreachable-after-jump", () => {
  it("warns on a snippet after one that ends with END (the starter's case), naming both", () => {
    const issues = validateProject({ project, scenes: [scene([line("hello"), jumper("end"), line("after")])] })
      .filter((i) => i.code === "unreachable-after-jump");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", id: "after", jumper: "end" });
    expect(issues[0]!.message).toBe("snippet 'after' in block 'b' never runs: snippet 'end' before it always jumps to END");
  });

  it("names every sibling after the jump, groups included, but not what's inside them", () => {
    expect(unreachable([jumper("go", "b2"), line("a"), { id: "g", type: "group", children: [line("inner")] }]))
      .toEqual([["a", "go"], ["g", "go"]]);
  });

  it("doesn't warn after a snippet with a condition (a branch that might not be taken)", () => {
    expect(unreachable([jumper("maybe", "END", { condition: "@scene.x" }), line("after")])).toEqual([]);
  });

  it("doesn't warn after a call, which comes back", () => {
    expect(unreachable([{ ...line("c"), jump: { to: "b2", mode: "call" } }, line("after")])).toEqual([]);
  });

  it("counts a jump-only snippet (no beats) as a jump", () => {
    expect(unreachable([line("a"), { id: "j", type: "snippet", jump: { to: "b2" } }, line("after")])).toEqual([["after", "j"]]);
  });

  it("doesn't warn after a choice whose option jumps: content after the choice group still runs", () => {
    expect(unreachable([
      { id: "ch", type: "group", selector: "choice", children: [option("o1", [jumper("o1_go")]), option("o2", [line("o2_say")])] },
      line("after"),
    ])).toEqual([]);
  });

  it("doesn't warn after a choice even when every option jumps unconditionally", () => {
    expect(unreachable([
      { id: "ch", type: "group", selector: "choice", children: [option("o1", [jumper("o1_go")]), option("o2", [jumper("o2_go", "b2")])] },
      line("after"),
    ])).toEqual([]);
  });

  it("warns inside an option's own run, after an unconditioned jump there", () => {
    expect(unreachable([
      { id: "ch", type: "group", selector: "choice", children: [option("o1", [line("o1_say"), jumper("o1_go"), line("o1_after")])] },
      line("after"),
    ])).toEqual([["o1_after", "o1_go"]]);
  });

  it("doesn't warn after a conditional group that jumps", () => {
    expect(unreachable([{ id: "g", type: "group", condition: "@scene.x", children: [jumper("go")] }, line("after")])).toEqual([]);
  });

  it("carries a jump out of a plain run group with no condition: it always runs, and always leaves", () => {
    expect(unreachable([{ id: "g", type: "group", children: [line("a"), jumper("go")] }, line("after")])).toEqual([["after", "go"]]);
  });

  it("never carries a jump out of a branch or a sequence child, but warns inside that child's own run", () => {
    for (const selector of ["branch", "sequence"] as const) {
      expect(unreachable([
        { id: "sel", type: "group", selector, children: [
          { id: "c1", type: "group", children: [jumper("go"), line("c1_after")] },
          jumper("c2_go"),
        ] },
        line("after"),
      ]), selector).toEqual([["c1_after", "go"]]);
    }
  });

  it("isn't raised for a branch child behind one with no condition (that's coverage's, not a warning)", () => {
    const children: Array<Group | Snippet> = [{ id: "br", type: "group", selector: "branch", children: [line("first"), line("never")] }];
    expect(unreachable(children)).toEqual([]);
    expect(neverRunNodes(children)).toEqual([{ id: "never", type: "snippet", reason: "branch-shadowed", by: "first" }]);
  });

  it("skips malformed shapes rather than throwing", () => {
    expect(neverRunNodes(undefined)).toEqual([]);
    expect(neverRunNodes([null, 3, { id: "g", type: "group" }, jumper("go"), "x", line("after")]))
      .toEqual([{ id: "after", type: "snippet", reason: "after-jump", jumper: "go", to: "END" }]);
  });
});
