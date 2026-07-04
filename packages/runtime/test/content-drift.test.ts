// ---------------------------------------------------------------------------
// Content-drift on load (§9.8): a save taken against older content, loaded into
// a bundle where that content has been deleted, resumes best-effort - the
// missing snippet / container is dropped and play continues (or ends) rather
// than throwing.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "cd", name: "CD" },
  locales: { default: "en", all: ["en"] }, cast: [{ name: "NPC" }],
};
const en = (scene: string, strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene, locale: "en", strings });

describe("content drift on load", () => {
  it("resumes without throwing when the saved node/container is gone", () => {
    // v1: a block "b" with a snippet "s1", which jumps into block "b2".
    const v1: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "NPC" }], jump: { to: "b2" } },
      ] },
      { id: "b2", type: "block", name: "B2", children: [
        { id: "s2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ] };
    const a = new Engine(exportBundle({ project, scenes: [v1], locales: [en("s", { L1: "one", L2: "two" })] }));
    const fa = a.openFlow("f", { scene: "s" });
    expect(fa.advance()).toMatchObject({ type: "line", text: "one" }); // active snippet s1, frame on block b
    const save = JSON.parse(JSON.stringify(a.saveGame()));

    // v2: the story was re-cut - "b" and "s1" are gone; only an unrelated block remains.
    const v2: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "other", type: "block", name: "Other", children: [
        { id: "z", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ] };
    const b = new Engine(exportBundle({ project, scenes: [v2], locales: [en("s", { L: "new" })] }));

    expect(() => b.loadGame(save)).not.toThrow();
    // missing active snippet -> dropped; drifted block frame -> skipped -> the flow ends cleanly.
    expect(b.getFlow("f")!.advance()).toEqual({ type: "end" });
  });

  it("a save mid-call whose CALLEE was deleted pops the drifted frame and resumes in the caller", () => {
    const v1: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "main", type: "block", name: "Main", children: [
        { id: "m1", type: "snippet", beats: [{ id: "M1", kind: "line", character: "NPC" }], jump: { to: "sub", mode: "call" } },
        { id: "m2", type: "snippet", beats: [{ id: "M2", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
      { id: "sub", type: "block", name: "Sub", children: [
        { id: "x1", type: "snippet", beats: [{ id: "X1", kind: "line", character: "NPC" }] },
        { id: "x2", type: "snippet", beats: [{ id: "X2", kind: "line", character: "NPC" }] },
      ] },
    ] };
    const a = new Engine(exportBundle({ project, scenes: [v1], locales: [en("s", { M1: "before", M2: "after", X1: "t1", X2: "t2" })] }));
    const fa = a.openFlow("f", { scene: "s" });
    fa.advance(); // "before"
    expect(fa.advance()).toMatchObject({ text: "t1" }); // one call deep, x2 still pending
    const save = JSON.parse(JSON.stringify(a.saveGame()));

    // v2: the tunnel block is gone (and the call jump with it).
    const v2: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "main", type: "block", name: "Main", children: [
        { id: "m1", type: "snippet", beats: [{ id: "M1", kind: "line", character: "NPC" }] },
        { id: "m2", type: "snippet", beats: [{ id: "M2", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ] };
    const b = new Engine(exportBundle({ project, scenes: [v2], locales: [en("s", { M1: "before", M2: "after" })] }));
    b.loadGame(save);
    // The drifted "sub" frame is skipped; play resumes at the caller's next child.
    expect(b.getFlow("f")!.advance()).toMatchObject({ type: "line", text: "after" });
  });

  it("a saved pending choice whose group was deleted loads without throwing (positional frames - shifted siblings may be skipped)", () => {
    // Stack frames are POSITIONAL (container + index), so deleting a node
    // before the cursor shifts later siblings out from under the saved index -
    // the documented best-effort trade of §9.8 (resume-at-nearest is deferred).
    const choiceScene = (filler: "choice" | "plain"): Scene => ({ id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        filler === "choice"
          ? { id: "g", type: "group", selector: "choice", children: [
              { id: "opt", type: "snippet", jump: { to: "END" } },
            ] }
          : { id: "swap", type: "snippet", beats: [{ id: "SW", kind: "line", character: "NPC" }] },
        { id: "after", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ] });
    const strings = en("s", { C: "Pick me", L: "carried on", SW: "swapped in" });
    const a = new Engine(exportBundle({ project, scenes: [choiceScene("choice")], locales: [strings] }));
    const fa = a.openFlow("f", { scene: "s" });
    expect(fa.advance()).toMatchObject({ type: "choice" });
    const save = JSON.parse(JSON.stringify(a.saveGame()));

    // The group replaced IN PLACE: the saved index still lines up -> play continues.
    const b = new Engine(exportBundle({ project, scenes: [choiceScene("plain")], locales: [strings] }));
    expect(() => b.loadGame(save)).not.toThrow();
    expect(b.getFlow("f")!.advance()).toMatchObject({ type: "line", text: "carried on" });
  });

  it("a LIVE jump to a missing target throws (drift tolerance is a load-time policy only)", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "NPC" }], jump: { to: "ghost" } },
      ] },
    ] };
    // exportBundle does not validate, so the dangling jump reaches the runtime.
    const engine = new Engine(exportBundle({ project, scenes: [scene], locales: [en("s", { L1: "one" })] }));
    const flow = engine.openFlow("f", { scene: "s" });
    flow.advance(); // the line
    expect(() => flow.advance()).toThrow(/jump target not found/);
  });
});
