// ---------------------------------------------------------------------------
// Selector coverage: branch (the spec's universal conditional-branch
// primitive - spec §4) and the one `sequence` selector across its order x exhaust
// modes - sequential repeat (cycle) / once, shuffle (bag, no back-to-back; incl.
// the cursor across save/load), and the shared (pooled) variants (spec §7).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile, Group, Snippet } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0", project: { id: "sel", name: "Sel" },
  locales: { default: "en", all: ["en"] },
  ...extra,
});
const loc = (scene: string, strings: Record<string, string>): LocaleFile => ({
  schema: "patter/strings@0", scene, locale: "en", strings,
});
const text = (id: string, beat: string, jump?: string): Snippet => ({
  id, type: "snippet", beats: [{ id: beat, kind: "text" }],
  ...(jump ? { jump: { to: jump } } : {}),
});

/** Drain a flow to its end, returning the text lines seen. */
function lines(flow: { advance(): { type: string; text?: string } }): string[] {
  const out: string[] = [];
  for (let i = 0; i < 100; i++) {
    const r = flow.advance();
    if (r.type === "end") return out;
    if (r.type === "text" && r.text) out.push(r.text);
  }
  throw new Error("did not end");
}

describe("branch", () => {
  // The if / elseif / else shape: first eligible child wins, in order.
  const scene: Scene = {
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "branch", children: [
        { ...text("hi", "T_hi", "END"), condition: "@hp > 10" },
        { ...text("mid", "T_mid", "END"), condition: "@hp > 5" },
        text("low", "T_low", "END"),
      ] } as Group,
    ] }],
  };
  const bundle = exportBundle({
    project: project({ properties: [{ name: "hp", type: "number", shared: true, default: 0 }] }),
    scenes: [scene],
    locales: [loc("s", { T_hi: "high", T_mid: "mid", T_low: "low" })],
  });

  it.each([
    [20, "high"],
    [7, "mid"],
    [1, "low"],
  ])("hp=%i picks the first passing branch (%s)", (hp, expected) => {
    const engine = new Engine(bundle);
    engine.setProperty("@hp", hp);
    expect(lines(engine.openFlow("main", { scene: "s" }))).toEqual([expected]);
  });
});

describe("sequence sequential: repeat (cycle) / once", () => {
  // A loop: the selector group gathers, then the gate loops back or ends.
  const loopScene = (selGroup: Group): Scene => ({
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "loop", type: "block", name: "Loop", children: [
        selGroup,
        { id: "gate", type: "snippet", condition: "visits('loop') < 4", jump: { to: "loop" } },
        { id: "done", type: "snippet", jump: { to: "END" } },
      ] },
    ],
  });
  const strings = loc("s", { T_a: "A", T_b: "B" });

  it("repeat (cycle) wraps around its children", () => {
    const bundle = exportBundle({
      project: project(),
      scenes: [loopScene({ id: "g", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "repeat" }, children: [text("a", "T_a"), text("b", "T_b")] })],
      locales: [strings],
    });
    expect(lines(new Engine(bundle).openFlow("main", { scene: "s" }))).toEqual(["A", "B", "A", "B"]);
  });

  it("once spends each child, then contributes nothing", () => {
    const bundle = exportBundle({
      project: project(),
      scenes: [loopScene({ id: "g", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [text("a", "T_a"), text("b", "T_b")] })],
      locales: [strings],
    });
    expect(lines(new Engine(bundle).openFlow("main", { scene: "s" }))).toEqual(["A", "B"]); // 4 loops, 2 yields
  });
});

describe("shuffle (bag, no back-to-back)", () => {
  const scene: Scene = {
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "loop", type: "block", name: "Loop", children: [
        { id: "g", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" },
          children: [text("a", "T_a"), text("b", "T_b"), text("c", "T_c")] } as Group,
        { id: "gate", type: "snippet", condition: "visits('loop') < 10", jump: { to: "loop" } },
        { id: "done", type: "snippet", jump: { to: "END" } },
      ] },
    ],
  };
  const bundle = exportBundle({
    project: project(),
    scenes: [scene],
    locales: [loc("s", { T_a: "A", T_b: "B", T_c: "C" })],
  });

  it("never repeats the previous pick", () => {
    const drawn = lines(new Engine(bundle, { seed: 1234 }).openFlow("main", { scene: "s" }));
    expect(drawn).toHaveLength(10);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1]);
  });

  it("the `last` cursor and PRNG survive save/load (saved run = unsaved run)", () => {
    const unsaved = lines(new Engine(bundle, { seed: 77 }).openFlow("main", { scene: "s" }));

    // Replay, snapshotting + restoring into a FRESH engine after every text.
    let engine = new Engine(bundle, { seed: 77 });
    engine.openFlow("main", { scene: "s" });
    const saved: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = engine.getFlow("main")!.advance();
      if (r.type === "end") break;
      if (r.type === "text") {
        saved.push(r.text);
        const blob = JSON.parse(JSON.stringify(engine.saveGame()));
        engine = new Engine(bundle, { seed: 77 });
        engine.loadGame(blob);
      }
    }
    expect(saved).toEqual(unsaved);
  });
});

describe("shared selector memory (pooled across flows - spec §7)", () => {
  const oneShot = (options: { order?: "sequential" | "shuffle"; exhaust?: "once" | "repeat" | "stick" }): Scene => ({
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "sequence", shared: true, options,
        children: [text("a", "T_a", "END"), text("b", "T_b", "END")] } as Group,
      { id: "fallthrough", type: "snippet", beats: [{ id: "T_n", kind: "text" }], jump: { to: "END" } },
    ] }],
  });
  const strings = loc("s", { T_a: "A", T_b: "B", T_n: "nothing left" });

  it("shared once: the first flow to play it spends it for everyone", () => {
    const bundle = exportBundle({ project: project(), scenes: [oneShot({ order: "sequential", exhaust: "once" })], locales: [strings] });
    const engine = new Engine(bundle);
    expect(lines(engine.openFlow("alice", { scene: "s" }))).toEqual(["A"]);
    expect(lines(engine.openFlow("bob", { scene: "s" }))).toEqual(["B"]);
    expect(lines(engine.openFlow("cara", { scene: "s" }))).toEqual(["nothing left"]); // pool exhausted
  });

  it("shared repeat (cycle): entries hand out across flows globally", () => {
    const bundle = exportBundle({ project: project(), scenes: [oneShot({ order: "sequential", exhaust: "repeat" })], locales: [strings] });
    const engine = new Engine(bundle);
    expect(lines(engine.openFlow("alice", { scene: "s" }))).toEqual(["A"]);
    expect(lines(engine.openFlow("bob", { scene: "s" }))).toEqual(["B"]);
    expect(lines(engine.openFlow("cara", { scene: "s" }))).toEqual(["A"]); // wrapped
  });

  it("shared shuffle: two flows never draw the same line back-to-back", () => {
    const bundle = exportBundle({
      project: project(),
      scenes: [oneShot({ order: "shuffle", exhaust: "repeat" })],
      locales: [strings],
    });
    const engine = new Engine(bundle, { seed: 5 });
    const first = lines(engine.openFlow("alice", { scene: "s" }))[0];
    const second = lines(engine.openFlow("bob", { scene: "s" }))[0];
    expect(first).not.toBe(second); // the pooled `last` excludes alice's draw for bob
  });
});
