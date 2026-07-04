// ---------------------------------------------------------------------------
// Sequential blocks + call-return jumps (spec §3). A block plays its children
// in order (gather); a snippet's jump decides the seam after it: none ->
// continue the block; `call` -> tunnel out and resume at the NEXT child on
// return; `jump` -> absolute (abandons pending returns). `END` hard-ends.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile, Beat, Jump } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "cr", name: "CR" },
  locales: { default: "en", all: ["en"] }, cast: [{ name: "NPC" }],
};
const line = (id: string): Beat => ({ id, kind: "line", character: "NPC" });
const snip = (id: string, beatId: string, jump?: Jump) =>
  ({ id, type: "snippet" as const, beats: [line(beatId)], ...(jump ? { jump } : {}) });

function play(scene: Scene, strings: Record<string, string>, choices: string[] = []): unknown[] {
  const en: LocaleFile = { schema: "patter/strings@0", scene: scene.id, locale: "en", strings };
  const flow = new Engine(exportBundle({ project, scenes: [scene], locales: [en] })).openFlow("f", { scene: scene.id });
  const scripted = [...choices];
  const out: unknown[] = [];
  for (let i = 0; i < 50; i++) {
    const r: StepResult = flow.advance();
    out.push(r.type === "line" ? { line: r.text } : r.type === "choice" ? { choice: r.options.map((o) => o.id) } : { [r.type]: true });
    if (r.type === "end") break;
    if (r.type === "choice") flow.choose(scripted.shift() ?? r.options.find((o) => o.eligible)!.id);
  }
  return out;
}

describe("sequential blocks + call-return", () => {
  it("a block plays its children in order (no jumps = gather)", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [snip("s1", "La"), snip("s2", "Lb"), snip("s3", "Lc")] },
    ] };
    expect(play(scene, { La: "a", Lb: "b", Lc: "c" })).toEqual([
      { line: "a" }, { line: "b" }, { line: "c" }, { end: true },
    ]);
  });

  it("a call jump tunnels out and returns to the next child in the block", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "main", type: "block", name: "Main", children: [
        snip("m1", "M1", { to: "sub", mode: "call" }),  // call -> sub, return after
        snip("m2", "M2"),                                // ...resumes here
      ] },
      { id: "sub", type: "block", name: "Sub", children: [snip("x", "X")] }, // falls off -> returns
    ] };
    expect(play(scene, { M1: "before", X: "tunnel", M2: "after" })).toEqual([
      { line: "before" }, { line: "tunnel" }, { line: "after" }, { end: true },
    ]);
  });

  it("calls nest and recurse via the callstack", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "main", type: "block", name: "Main", children: [
        snip("m1", "M1", { to: "a", mode: "call" }), snip("m2", "M2"),
      ] },
      { id: "a", type: "block", name: "A", children: [
        snip("a1", "A1", { to: "b", mode: "call" }), snip("a2", "A2"),
      ] },
      { id: "b", type: "block", name: "B", children: [snip("b1", "B1")] },
    ] };
    expect(play(scene, { M1: "m1", A1: "a1", B1: "b1", A2: "a2", M2: "m2" })).toEqual([
      { line: "m1" }, { line: "a1" }, { line: "b1" }, { line: "a2" }, { line: "m2" }, { end: true },
    ]);
  });

  it("a chosen option gathers back into the block when it has no jump", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "go", type: "snippet", beats: [line("OG")] }, // no jump -> gather
        ] },
        snip("after", "AF"),
      ] },
    ] };
    expect(play(scene, { CT: "Pick", OG: "chose", AF: "and continued" }, ["go"])).toEqual([
      { choice: ["go"] }, { line: "chose" }, { line: "and continued" }, { end: true },
    ]);
  });

  it("save/restore mid-tunnel preserves the callstack and returns correctly", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "main", type: "block", name: "Main", children: [
        snip("m1", "M1", { to: "sub", mode: "call" }), snip("m2", "M2"),
      ] },
      { id: "sub", type: "block", name: "Sub", children: [snip("x", "X")] },
    ] };
    const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { M1: "before", X: "tunnel", M2: "after" } };
    const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

    const e1 = new Engine(bundle);
    const f1 = e1.openFlow("f", { scene: "s" });
    expect(f1.advance()).toMatchObject({ type: "line", text: "before" });
    expect(f1.advance()).toMatchObject({ type: "line", text: "tunnel" }); // now one call deep
    const save = JSON.parse(JSON.stringify(e1.saveGame()));

    const e2 = new Engine(bundle);
    e2.loadGame(save);
    const f2 = e2.getFlow("f")!;
    expect(f2.advance()).toMatchObject({ type: "line", text: "after" }); // popped back to main
    expect(f2.advance()).toEqual({ type: "end" });
  });

  it("a run-group plays its children in order, then the block gathers", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "run", children: [snip("g1", "G1"), snip("g2", "G2")] },
        snip("after", "AF"),
      ] },
    ] };
    expect(play(scene, { G1: "one", G2: "two", AF: "three" })).toEqual([
      { line: "one" }, { line: "two" }, { line: "three" }, { end: true },
    ]);
  });

  it("an omitted group selector defaults to a run", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", children: [snip("g1", "G1"), snip("g2", "G2")] }, // no selector -> run
      ] },
    ] };
    expect(play(scene, { G1: "a", G2: "b" })).toEqual([{ line: "a" }, { line: "b" }, { end: true }]);
  });

  it("a chosen option that is a run-group runs its content, then gathers", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "ch", type: "group", selector: "choice", children: [
          { id: "opt", type: "group", children: [snip("o1", "O1"), snip("o2", "O2")] }, // option = a run
        ] },
        snip("after", "AF"),
      ] },
    ] };
    expect(play(scene, { O1: "picked one", O2: "picked two", AF: "gathered" }, ["opt"])).toEqual([
      { choice: ["opt"] }, { line: "picked one" }, { line: "picked two" }, { line: "gathered" }, { end: true },
    ]);
  });

  it("a jump is absolute - it abandons a pending call-return", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "main", type: "block", name: "Main", children: [
        snip("m1", "M1", { to: "sub", mode: "call" }), snip("m2", "M2"), // m2 should NOT run
      ] },
      { id: "sub", type: "block", name: "Sub", children: [snip("x", "X", { to: "other", mode: "jump" })] },
      { id: "other", type: "block", name: "Other", children: [snip("y", "Y")] },
    ] };
    expect(play(scene, { M1: "before", X: "tunnel", Y: "elsewhere", M2: "after" })).toEqual([
      { line: "before" }, { line: "tunnel" }, { line: "elsewhere" }, { end: true },
    ]);
  });
});
